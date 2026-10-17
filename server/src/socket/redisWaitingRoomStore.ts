// server/src/socket/redisWaitingRoomStore.ts

import type { Redis } from "ioredis";
import type {
  MatchLease,
  WaitingEntry,
  WaitingRoomSnapshot,
  WaitingRoomStore,
} from "./waitingRoomStore.js";
import { MatchLeaseTtlMs } from "./waitingRoomStore.js";

const ScanBatchSize = 100;

/**
 * Record this token as the room's high-water mark unless a strictly newer one
 * is already there. Equal passes, so one attempt can write several cohorts. Redis runs a script atomically, which is what makes the
 * read and the write one step — a plain GET then SET would let two attempts
 * both pass the comparison.
 */
/**
 * Lease bookkeeping lives OUTSIDE the `ame:match:*` namespace on purpose. The
 * waiting rooms are hashes and every sweep in this file — `removeFromAll`,
 * `findParticipant`, `getRoomsForExperiment` — SCANs that pattern and runs a
 * hash command on whatever it finds. A lease's keys are plain strings, so
 * parking them alongside the rooms made a participant closing their tab raise
 * WRONGTYPE inside the disconnect handler and take the server down.
 */
const LeasePrefix = "ame:lease:";

const CommitIfNewerScript = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local token = tonumber(ARGV[1])
if token >= current then
  redis.call('SET', KEYS[1], token)
  return 1
end
return 0
`;

/**
 * Delete the lock only while it still holds OUR token. A lapsed lease may
 * already have been taken by a newer attempt, and deleting that one would let a
 * third attempt in while the second is still working.
 */
const ReleaseIfMineScript = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export class RedisWaitingRoomStore implements WaitingRoomStore {
  constructor(private redis: Redis) {}

  async add(roomKey: string, entry: WaitingEntry): Promise<void> {
    const existing = await this.redis.hget(roomKey, entry.participantId);
    if (existing) return; // No duplicates
    await this.redis.hset(roomKey, entry.participantId, JSON.stringify(entry));
  }

  async remove(
    roomKey: string,
    participantId: string,
  ): Promise<WaitingEntry | null> {
    const raw = await this.redis.hget(roomKey, participantId);
    if (!raw) return null;
    await this.redis.hdel(roomKey, participantId);
    return JSON.parse(raw) as WaitingEntry;
  }

  async getEntries(roomKey: string): Promise<WaitingEntry[]> {
    const all = await this.redis.hvals(roomKey);
    return all.map((v) => JSON.parse(v) as WaitingEntry);
  }

  async getRoomsForExperiment(
    experimentId: string,
  ): Promise<WaitingRoomSnapshot[]> {
    const pattern = `ame:match:${experimentId}:*`;
    // SCAN may return the same key in more than one iteration. Collecting into
    // a Map keyed by room makes that harmless; the previous flat push counted
    // such a room's participants twice — once in the dashboard table, and once
    // in the property balancer that reads getEntriesForExperiment.
    const byRoomKey = new Map<string, WaitingEntry[]>();
    let cursor = "0";
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        ScanBatchSize,
      );
      cursor = nextCursor;
      for (const roomKey of keys) {
        const vals = await this.redis.hvals(roomKey);
        byRoomKey.set(
          roomKey,
          vals.map((v) => JSON.parse(v) as WaitingEntry),
        );
      }
    } while (cursor !== "0");
    return [...byRoomKey.entries()].map(([roomKey, entries]) => ({
      roomKey,
      entries,
    }));
  }

  async getEntriesForExperiment(
    experimentId: string,
  ): Promise<WaitingEntry[]> {
    const rooms = await this.getRoomsForExperiment(experimentId);
    return rooms.flatMap((room) => room.entries);
  }

  async clear(roomKey: string): Promise<void> {
    await this.redis.del(roomKey);
  }

  async findParticipant(
    participantId: string,
  ): Promise<{ roomKey: string; entry: WaitingEntry } | null> {
    const pattern = "ame:match:*";
    let cursor = "0";
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        ScanBatchSize,
      );
      cursor = nextCursor;
      for (const key of keys) {
        const raw = await this.redis.hget(key, participantId);
        if (raw) {
          return { roomKey: key, entry: JSON.parse(raw) as WaitingEntry };
        }
      }
    } while (cursor !== "0");
    return null;
  }

  async acquireMatchLease(
    roomKey: string,
    ttlMs: number = MatchLeaseTtlMs,
  ): Promise<MatchLease | null> {
    // The token is drawn before the lock is attempted, so it rises even for
    // attempts that never acquire — tokens must be monotonic, not gapless.
    const token = await this.redis.incr(`${LeasePrefix}fence:${roomKey}`);
    const lockKey = `${LeasePrefix}lock:${roomKey}`;
    const held = await this.redis.set(lockKey, String(token), "PX", ttlMs, "NX");
    if (held !== "OK") return null;

    return {
      token,
      commit: async () => {
        const applied = await this.redis.eval(
          CommitIfNewerScript,
          1,
          `${LeasePrefix}committed:${roomKey}`,
          String(token),
        );
        return applied === 1;
      },
      release: async () => {
        await this.redis.eval(ReleaseIfMineScript, 1, lockKey, String(token));
      },
    };
  }

  async removeFromAll(participantId: string): Promise<string[]> {
    const affectedRooms: string[] = [];
    const pattern = "ame:match:*";
    let cursor = "0";
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        ScanBatchSize,
      );
      cursor = nextCursor;
      for (const key of keys) {
        const removed = await this.redis.hdel(key, participantId);
        if (removed > 0) affectedRooms.push(key);
      }
    } while (cursor !== "0");
    return affectedRooms;
  }
}
