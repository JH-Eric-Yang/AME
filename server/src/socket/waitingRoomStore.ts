// server/src/socket/waitingRoomStore.ts

export interface WaitingEntry {
  participantId: string;
  socketId: string;
  condition: string | null;
  /**
   * The recruitment-platform id, when the experiment captures one. Optional
   * because it is absent from every entry written before this field existed —
   * in Redis those entries are already serialised JSON.
   */
  externalId?: string | null;
  properties: Record<string, unknown>;
  joinedAt: number;
}

/** One waiting room and everyone in it, with the key that names its routine. */
export interface WaitingRoomSnapshot {
  roomKey: string;
  entries: WaitingEntry[];
}

/**
 * A lease on one waiting room's match attempt, carrying a fencing token.
 *
 * A lock alone is not enough. A holder can stall — a long GC pause, a slow
 * database round trip — until its lease expires and a second attempt takes the
 * room. Both then believe they hold it. The token makes that harmless: it rises
 * with every acquisition, and `commit` refuses a token no higher than the one
 * the room has already committed, so the stalled holder cannot write a session
 * after a newer attempt has.
 */
export interface MatchLease {
  /** Monotonically increasing per room. A higher token is a later attempt. */
  readonly token: number;
  /**
   * Claim the right to write, recording the token as the room's high-water
   * mark. Call it immediately before every session write, not once per lease:
   * a holder that stalls between two writes must be stopped at the second.
   *
   * Re-committing the same token succeeds, so one attempt can form several
   * cohorts from a room that holds more than one.
   *
   * @returns false when a strictly newer attempt already committed — the caller
   *          must then abandon without writing anything.
   */
  commit(): Promise<boolean>;
  /** Release the lease, but only if this lease still holds it. */
  release(): Promise<void>;
}

/** How long a match attempt may hold a room before the lease lapses. */
export const MatchLeaseTtlMs = 5000;

export interface WaitingRoomStore {
  add(roomKey: string, entry: WaitingEntry): Promise<void>;
  remove(roomKey: string, participantId: string): Promise<WaitingEntry | null>;
  getEntries(roomKey: string): Promise<WaitingEntry[]>;
  /**
   * Every room of one experiment, still grouped. The admin snapshot needs the
   * room key of each entry; recovering it afterwards via findParticipant costs
   * a full `ame:match:*` SCAN per participant in the Redis store, so it is
   * never thrown away in the first place.
   */
  getRoomsForExperiment(experimentId: string): Promise<WaitingRoomSnapshot[]>;
  getEntriesForExperiment(experimentId: string): Promise<WaitingEntry[]>;
  clear(roomKey: string): Promise<void>;
  findParticipant(participantId: string): Promise<{ roomKey: string; entry: WaitingEntry } | null>;
  removeFromAll(participantId: string): Promise<string[]>;
  /**
   * Take the lease on a room's match attempt.
   *
   * @returns null when another attempt already holds it — the caller should do
   *          nothing, because the holder is forming the session.
   */
  acquireMatchLease(roomKey: string, ttlMs?: number): Promise<MatchLease | null>;
}

export class MemoryWaitingRoomStore implements WaitingRoomStore {
  private rooms = new Map<string, WaitingEntry[]>();
  /** Next fencing token per room. */
  private fences = new Map<string, number>();
  /** The lease currently held, with the wall clock at which it lapses. */
  private leases = new Map<string, { token: number; expiresAt: number }>();
  /** Highest token that has committed a session for each room. */
  private committed = new Map<string, number>();

  async add(roomKey: string, entry: WaitingEntry): Promise<void> {
    if (!this.rooms.has(roomKey)) {
      this.rooms.set(roomKey, []);
    }
    const room = this.rooms.get(roomKey)!;
    if (room.some((e) => e.participantId === entry.participantId)) {
      return; // No duplicates
    }
    room.push(entry);
  }

  async remove(roomKey: string, participantId: string): Promise<WaitingEntry | null> {
    const room = this.rooms.get(roomKey);
    if (!room) return null;
    const idx = room.findIndex((e) => e.participantId === participantId);
    if (idx === -1) return null;
    const [entry] = room.splice(idx, 1);
    if (room.length === 0) this.rooms.delete(roomKey);
    return entry;
  }

  async getEntries(roomKey: string): Promise<WaitingEntry[]> {
    // A copy, not the live array. Callers splice the result while choosing a
    // cohort, and handing out the internal one let that splice delete from the
    // store itself — so the follow-up `remove` found nothing to claim. The
    // Redis store returns freshly parsed objects, so it never behaved this way;
    // the two must agree or tests and production diverge.
    return [...(this.rooms.get(roomKey) ?? [])];
  }

  async getRoomsForExperiment(experimentId: string): Promise<WaitingRoomSnapshot[]> {
    const prefix = `ame:match:${experimentId}:`;
    const result: WaitingRoomSnapshot[] = [];
    for (const [roomKey, entries] of this.rooms) {
      if (roomKey.startsWith(prefix)) {
        result.push({ roomKey, entries: [...entries] });
      }
    }
    return result;
  }

  async getEntriesForExperiment(experimentId: string): Promise<WaitingEntry[]> {
    const rooms = await this.getRoomsForExperiment(experimentId);
    return rooms.flatMap((room) => room.entries);
  }

  async clear(roomKey: string): Promise<void> {
    this.rooms.delete(roomKey);
  }

  async findParticipant(participantId: string): Promise<{ roomKey: string; entry: WaitingEntry } | null> {
    for (const [roomKey, entries] of this.rooms) {
      const entry = entries.find((e) => e.participantId === participantId);
      if (entry) return { roomKey, entry };
    }
    return null;
  }

  async acquireMatchLease(
    roomKey: string,
    ttlMs: number = MatchLeaseTtlMs,
  ): Promise<MatchLease | null> {
    const held = this.leases.get(roomKey);
    if (held && held.expiresAt > Date.now()) return null;

    const token = (this.fences.get(roomKey) ?? 0) + 1;
    this.fences.set(roomKey, token);
    this.leases.set(roomKey, { token, expiresAt: Date.now() + ttlMs });

    return {
      token,
      commit: async () => {
        if ((this.committed.get(roomKey) ?? 0) > token) return false;
        this.committed.set(roomKey, token);
        return true;
      },
      release: async () => {
        // Only if we still hold it: a lapsed lease may already belong to a
        // newer attempt, and releasing that one would let a third in.
        if (this.leases.get(roomKey)?.token === token) this.leases.delete(roomKey);
      },
    };
  }

  async removeFromAll(participantId: string): Promise<string[]> {
    const affectedRooms: string[] = [];
    for (const [key, room] of this.rooms) {
      const idx = room.findIndex((e) => e.participantId === participantId);
      if (idx !== -1) {
        room.splice(idx, 1);
        affectedRooms.push(key);
        if (room.length === 0) this.rooms.delete(key);
      }
    }
    return affectedRooms;
  }
}
