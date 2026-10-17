import { describe, it, expect } from "vitest";
import {
  routineNameFromRoomKey,
  toQueueEntries,
  toQueueRooms,
} from "../socket/queueSnapshot.js";
import { MemoryWaitingRoomStore, type WaitingEntry } from "../socket/waitingRoomStore.js";

const JoinedAt = 1_757_150_000_000;

const entry = (
  participantId: string,
  overrides: Partial<WaitingEntry> = {},
): WaitingEntry => ({
  participantId,
  socketId: `sock-${participantId}`,
  condition: "Basic",
  properties: {},
  joinedAt: JoinedAt,
  ...overrides,
});

describe("routineNameFromRoomKey", () => {
  it("takes the routine from the last segment of the room key", () => {
    expect(routineNameFromRoomKey("ame:match:exp-1:Chat-match")).toBe("Chat-match");
  });
});

describe("toQueueEntries", () => {
  it("carries externalId through and defaults it to null", () => {
    const entries = toQueueEntries([
      entry("p-1", { externalId: "PROLIFIC_6KD2" }),
      entry("p-2"),
    ]);
    expect(entries).toEqual([
      { participantId: "p-1", condition: "Basic", joinedAt: JoinedAt, externalId: "PROLIFIC_6KD2" },
      { participantId: "p-2", condition: "Basic", joinedAt: JoinedAt, externalId: null },
    ]);
  });

  it("does not leak socketId or properties to the dashboard", () => {
    const [queueEntry] = toQueueEntries([entry("p-1", { properties: { handedness: "L" } })]);
    expect(queueEntry).not.toHaveProperty("socketId");
    expect(queueEntry).not.toHaveProperty("properties");
  });
});

describe("toQueueRooms", () => {
  it("names each room by its routine and maps its entries", () => {
    expect(
      toQueueRooms([
        { roomKey: "ame:match:exp-1:Chat-match", entries: [entry("p-1")] },
        { roomKey: "ame:match:exp-1:Debrief-match", entries: [] },
      ]),
    ).toEqual([
      {
        routineName: "Chat-match",
        entries: [{ participantId: "p-1", condition: "Basic", joinedAt: JoinedAt, externalId: null }],
      },
      { routineName: "Debrief-match", entries: [] },
    ]);
  });
});

describe("MemoryWaitingRoomStore.getRoomsForExperiment", () => {
  it("groups entries by room key and excludes other experiments", async () => {
    const store = new MemoryWaitingRoomStore();
    await store.add("ame:match:exp-1:Chat-match", entry("p-1"));
    await store.add("ame:match:exp-1:Chat-match", entry("p-2"));
    await store.add("ame:match:exp-1:Debrief-match", entry("p-3"));
    await store.add("ame:match:exp-2:Chat-match", entry("p-4"));

    const rooms = await store.getRoomsForExperiment("exp-1");

    expect(
      rooms
        .map((room) => [room.roomKey, room.entries.map((e) => e.participantId)] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    ).toEqual([
      ["ame:match:exp-1:Chat-match", ["p-1", "p-2"]],
      ["ame:match:exp-1:Debrief-match", ["p-3"]],
    ]);
  });

  it("still answers the flat entry list the property balancer reads", async () => {
    const store = new MemoryWaitingRoomStore();
    await store.add("ame:match:exp-1:Chat-match", entry("p-1"));
    await store.add("ame:match:exp-1:Debrief-match", entry("p-2"));

    const entries = await store.getEntriesForExperiment("exp-1");
    expect(entries.map((e) => e.participantId).sort()).toEqual(["p-1", "p-2"]);
  });
});
