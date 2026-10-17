import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Redis } from "ioredis";
import { RedisWaitingRoomStore } from "../socket/redisWaitingRoomStore.js";
import type { WaitingEntry } from "../socket/waitingRoomStore.js";

const RoomKey = "ame:match:exp-1:Chat-match";
const JoinedAt = 1_757_150_000_000;

const entry = (participantId: string): WaitingEntry => ({
  participantId,
  socketId: `sock-${participantId}`,
  condition: "Basic",
  properties: {},
  joinedAt: JoinedAt,
});

// Only `scan` and `hvals` are reached by the methods under test, so the fake is
// those two. server/vitest.config.ts sets mockReset globally, so the
// implementations are installed per test rather than at module scope.
const scan = vi.fn();
const hvals = vi.fn();
const fakeRedis = { scan, hvals } as unknown as Redis;

describe("RedisWaitingRoomStore.getRoomsForExperiment", () => {
  beforeEach(() => {
    // SCAN makes no uniqueness guarantee across iterations: a key present for
    // the whole scan may legitimately be returned by more than one call. This
    // is the case a Map-backed store must survive and a flat push cannot.
    scan
      .mockResolvedValueOnce(["1", [RoomKey]])
      .mockResolvedValueOnce(["0", [RoomKey]]);
    hvals.mockResolvedValue([
      JSON.stringify(entry("p-1")),
      JSON.stringify(entry("p-2")),
    ]);
  });

  it("returns one room when SCAN yields the same key in two iterations", async () => {
    const store = new RedisWaitingRoomStore(fakeRedis);

    const rooms = await store.getRoomsForExperiment("exp-1");

    expect(rooms).toHaveLength(1);
    expect(rooms[0].roomKey).toBe(RoomKey);
    expect(rooms[0].entries.map((e) => e.participantId)).toEqual(["p-1", "p-2"]);
  });

  it("does not double-count a twice-scanned room's participants", async () => {
    const store = new RedisWaitingRoomStore(fakeRedis);

    const entries = await store.getEntriesForExperiment("exp-1");

    // Two waiting participants, not four. The flat push this replaced reported
    // four — once in the dashboard table, once in the property balancer.
    expect(entries.map((e) => e.participantId)).toEqual(["p-1", "p-2"]);
  });

  it("scopes the scan pattern to the one experiment", async () => {
    const store = new RedisWaitingRoomStore(fakeRedis);

    await store.getRoomsForExperiment("exp-1");

    expect(scan).toHaveBeenCalledWith(
      expect.any(String),
      "MATCH",
      "ame:match:exp-1:*",
      "COUNT",
      expect.any(Number),
    );
  });
});

/**
 * A Redis fake that enforces key types the way the real server does: a hash
 * command against a string key raises WRONGTYPE. That is the whole point —
 * the waiting rooms are hashes, and anything else parked in the namespace the
 * store scans turns a routine sweep into a thrown error.
 */
function createTypedRedisFake() {
  const strings = new Map<string, string>();
  const hashes = new Map<string, Map<string, string>>();

  const wrongType = (key: string) => {
    if (strings.has(key)) {
      throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
    }
  };

  return {
    keysTouched: () => [...strings.keys(), ...hashes.keys()],
    incr: async (key: string) => {
      const next = Number(strings.get(key) ?? "0") + 1;
      strings.set(key, String(next));
      return next;
    },
    set: async (key: string, value: string) => {
      strings.set(key, value);
      return "OK";
    },
    hset: async (key: string, field: string, value: string) => {
      const hash = hashes.get(key) ?? new Map<string, string>();
      hash.set(field, value);
      hashes.set(key, hash);
      return 1;
    },
    hdel: async (key: string, field: string) => {
      wrongType(key);
      return hashes.get(key)?.delete(field) ? 1 : 0;
    },
    hget: async (key: string, field: string) => {
      wrongType(key);
      return hashes.get(key)?.get(field) ?? null;
    },
    hvals: async (key: string) => {
      wrongType(key);
      return [...(hashes.get(key)?.values() ?? [])];
    },
    // Both lease scripts read and write a plain string key.
    eval: async (_script: string, _numKeys: number, key: string, arg: string) => {
      strings.set(key, arg);
      return 1;
    },
    scan: async (_cursor: string, _match: string, pattern: string) => {
      const re = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`);
      const all = [...strings.keys(), ...hashes.keys()];
      return ["0", all.filter((k) => re.test(k))];
    },
  };
}

describe("RedisWaitingRoomStore — lease keys stay out of the room namespace", () => {
  it("sweeps a disconnected participant from every room while a lease is held", async () => {
    // The crash this pins: the lease's bookkeeping keys are strings, the
    // waiting rooms are hashes, and `removeFromAll` HDELs every key matching
    // the room pattern. Park the lease inside that pattern and a participant
    // closing their tab takes the whole server down with a WRONGTYPE.
    const redis = createTypedRedisFake();
    const store = new RedisWaitingRoomStore(redis as unknown as Redis);
    await store.add(RoomKey, entry("p-1"));
    await store.acquireMatchLease(RoomKey);

    await expect(store.removeFromAll("p-1")).resolves.toEqual([RoomKey]);
  });

  it("finds a waiting participant while a lease is held", async () => {
    const redis = createTypedRedisFake();
    const store = new RedisWaitingRoomStore(redis as unknown as Redis);
    await store.add(RoomKey, entry("p-1"));
    await store.acquireMatchLease(RoomKey);

    const found = await store.findParticipant("p-1");

    expect(found?.roomKey).toBe(RoomKey);
  });

  it("keeps every lease key clear of the pattern the room scans use", async () => {
    const redis = createTypedRedisFake();
    const store = new RedisWaitingRoomStore(redis as unknown as Redis);
    await store.add(RoomKey, entry("p-1"));
    const lease = await store.acquireMatchLease(RoomKey);
    await lease!.commit();

    const roomPattern = /^ame:match:/;
    const leaseKeys = redis.keysTouched().filter((k) => k !== RoomKey);
    expect(leaseKeys.length).toBeGreaterThan(0);
    expect(leaseKeys.filter((k) => roomPattern.test(k))).toEqual([]);
  });
});
