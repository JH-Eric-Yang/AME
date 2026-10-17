import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryWaitingRoomStore } from "../socket/waitingRoomStore.js";

describe("Matching System Integration", () => {
  let store: MemoryWaitingRoomStore;

  beforeAll(() => {
    store = new MemoryWaitingRoomStore();
  });

  afterAll(async () => {
    // cleanup
  });

  describe("MemoryWaitingRoomStore", () => {
    it("adds and retrieves entries", async () => {
      await store.add("room:1", {
        participantId: "p1",
        socketId: "s1",
        condition: null,
        properties: { role: "gesturer" },
        joinedAt: Date.now(),
      });

      const entries = await store.getEntries("room:1");
      expect(entries).toHaveLength(1);
      expect(entries[0].participantId).toBe("p1");
    });

    it("prevents duplicate entries", async () => {
      await store.add("room:1", {
        participantId: "p1",
        socketId: "s1",
        condition: null,
        properties: { role: "gesturer" },
        joinedAt: Date.now(),
      });

      const entries = await store.getEntries("room:1");
      expect(entries).toHaveLength(1);
    });

    it("removes entries by participantId", async () => {
      const removed = await store.remove("room:1", "p1");
      expect(removed).not.toBeNull();
      expect(removed!.participantId).toBe("p1");

      const entries = await store.getEntries("room:1");
      expect(entries).toHaveLength(0);
    });

    it("gets entries for experiment across rooms", async () => {
      await store.add("ame:match:exp1:routine-a", {
        participantId: "p1",
        socketId: "s1",
        condition: null,
        properties: {},
        joinedAt: Date.now(),
      });
      await store.add("ame:match:exp1:routine-b", {
        participantId: "p2",
        socketId: "s2",
        condition: null,
        properties: {},
        joinedAt: Date.now(),
      });
      await store.add("ame:match:exp2:routine-a", {
        participantId: "p3",
        socketId: "s3",
        condition: null,
        properties: {},
        joinedAt: Date.now(),
      });

      const exp1Entries = await store.getEntriesForExperiment("exp1");
      expect(exp1Entries).toHaveLength(2);
      expect(exp1Entries.map((e) => e.participantId).sort()).toEqual([
        "p1",
        "p2",
      ]);
    });

    it("removes participant from all rooms", async () => {
      const affected = await store.removeFromAll("p1");
      expect(affected).toContain("ame:match:exp1:routine-a");
    });

    it("finds participant across rooms", async () => {
      const result = await store.findParticipant("p2");
      expect(result).not.toBeNull();
      expect(result!.roomKey).toBe("ame:match:exp1:routine-b");
    });

    it("clears a room", async () => {
      await store.clear("ame:match:exp1:routine-b");
      const entries = await store.getEntries("ame:match:exp1:routine-b");
      expect(entries).toHaveLength(0);
    });

    it("returns null when removing non-existent participant", async () => {
      const removed = await store.remove(
        "nonexistent-room",
        "nonexistent-id",
      );
      expect(removed).toBeNull();
    });

    it("returns null when finding non-existent participant", async () => {
      const result = await store.findParticipant("nonexistent-id");
      expect(result).toBeNull();
    });
  });

  describe("Balanced Property Assignment", () => {
    it("picks least represented value from array properties", async () => {
      const balanceStore = new MemoryWaitingRoomStore();

      // Simulate 2 existing waiters with role=gesturer
      await balanceStore.add("ame:match:exp1:match", {
        participantId: "existing-1",
        socketId: "s-1",
        condition: null,
        properties: { role: "gesturer" },
        joinedAt: Date.now(),
      });
      await balanceStore.add("ame:match:exp1:match", {
        participantId: "existing-2",
        socketId: "s-2",
        condition: null,
        properties: { role: "gesturer" },
        joinedAt: Date.now(),
      });

      // Simulate resolving array property for new participant
      const options = ["gesturer", "guesser"];
      const waitingEntries =
        await balanceStore.getEntriesForExperiment("exp1");

      const counts = new Map<unknown, number>();
      for (const opt of options) counts.set(opt, 0);
      for (const entry of waitingEntries) {
        const val = entry.properties["role"];
        if (val !== undefined && counts.has(val)) {
          counts.set(val, counts.get(val)! + 1);
        }
      }

      let minCount = Infinity;
      const candidates: unknown[] = [];
      for (const [opt, count] of counts) {
        if (count < minCount) {
          minCount = count;
          candidates.length = 0;
          candidates.push(opt);
        } else if (count === minCount) {
          candidates.push(opt);
        }
      }

      // guesser has 0 waiters, gesturer has 2 → should pick guesser
      expect(candidates).toEqual(["guesser"]);
    });

    it("randomly selects when counts are equal", async () => {
      const balanceStore = new MemoryWaitingRoomStore();

      // No waiters — both options have 0 count
      const options = ["gesturer", "guesser"];
      const waitingEntries =
        await balanceStore.getEntriesForExperiment("exp1");

      const counts = new Map<unknown, number>();
      for (const opt of options) counts.set(opt, 0);
      for (const entry of waitingEntries) {
        const val = entry.properties["role"];
        if (val !== undefined && counts.has(val)) {
          counts.set(val, counts.get(val)! + 1);
        }
      }

      let minCount = Infinity;
      const candidates: unknown[] = [];
      for (const [opt, count] of counts) {
        if (count < minCount) {
          minCount = count;
          candidates.length = 0;
          candidates.push(opt);
        } else if (count === minCount) {
          candidates.push(opt);
        }
      }

      // Both have 0 → both are candidates
      expect(candidates).toHaveLength(2);
      expect(candidates).toContain("gesturer");
      expect(candidates).toContain("guesser");
    });

    it("handles mixed distribution correctly", async () => {
      const balanceStore = new MemoryWaitingRoomStore();

      await balanceStore.add("ame:match:exp1:match", {
        participantId: "p1",
        socketId: "s1",
        condition: null,
        properties: { role: "gesturer" },
        joinedAt: Date.now(),
      });
      await balanceStore.add("ame:match:exp1:match", {
        participantId: "p2",
        socketId: "s2",
        condition: null,
        properties: { role: "guesser" },
        joinedAt: Date.now(),
      });
      await balanceStore.add("ame:match:exp1:match", {
        participantId: "p3",
        socketId: "s3",
        condition: null,
        properties: { role: "gesturer" },
        joinedAt: Date.now(),
      });

      const options = ["gesturer", "guesser", "observer"];
      const waitingEntries =
        await balanceStore.getEntriesForExperiment("exp1");

      const counts = new Map<unknown, number>();
      for (const opt of options) counts.set(opt, 0);
      for (const entry of waitingEntries) {
        const val = entry.properties["role"];
        if (val !== undefined && counts.has(val)) {
          counts.set(val, counts.get(val)! + 1);
        }
      }

      // gesturer: 2, guesser: 1, observer: 0
      expect(counts.get("gesturer")).toBe(2);
      expect(counts.get("guesser")).toBe(1);
      expect(counts.get("observer")).toBe(0);

      let minCount = Infinity;
      const candidates: unknown[] = [];
      for (const [opt, count] of counts) {
        if (count < minCount) {
          minCount = count;
          candidates.length = 0;
          candidates.push(opt);
        } else if (count === minCount) {
          candidates.push(opt);
        }
      }

      // observer has 0 → should be the only candidate
      expect(candidates).toEqual(["observer"]);
    });
  });
});
