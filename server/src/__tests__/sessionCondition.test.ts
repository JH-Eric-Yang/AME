import { describe, it, expect } from "vitest";
import {
  DefaultCondition,
  resolveSessionCondition,
} from "../socket/sessionCondition.js";

describe("resolveSessionCondition", () => {
  it("returns the condition of the lowest seat regardless of row order", () => {
    const seats = [
      { seat: 2, condition: "Gesture" },
      { seat: 0, condition: "Speech" },
      { seat: 1, condition: "Gesture" },
    ];

    expect(resolveSessionCondition(seats)).toBe("Speech");
  });

  it("gives every member of a session the same answer", () => {
    const seats = [
      { seat: 0, condition: "Speech" },
      { seat: 1, condition: "Gesture" },
      { seat: 2, condition: "Speech" },
      { seat: 3, condition: "Gesture" },
    ];
    const shuffled = [seats[3], seats[1], seats[2], seats[0]];

    expect(resolveSessionCondition(shuffled)).toBe(
      resolveSessionCondition(seats),
    );
  });

  it("keeps the anchor on the lowest seat even when that seat is DROPPED", () => {
    // The roster carries `status`, and resolveSessionCondition must ignore it.
    // If it skipped DROPPED seats the anchor would move from Speech to Gesture
    // the moment seat 0 withdrew, re-pairing the whole cohort mid-session.
    const roster = [
      { participantId: "p-0", seat: 0, condition: "Speech", status: "DROPPED" as const },
      { participantId: "p-1", seat: 1, condition: "Gesture", status: "ACTIVE" as const },
      { participantId: "p-2", seat: 2, condition: "Speech", status: "ACTIVE" as const },
    ];

    expect(resolveSessionCondition(roster)).toBe("Speech");
  });

  it("falls back to the default condition when the anchor seat has none", () => {
    const seats = [
      { seat: 0, condition: null },
      { seat: 1, condition: "Gesture" },
    ];

    expect(resolveSessionCondition(seats)).toBe(DefaultCondition);
    expect(DefaultCondition).toBe("Basic");
  });

  it("falls back to the default condition for an empty seat roster", () => {
    expect(resolveSessionCondition([])).toBe(DefaultCondition);
  });
});
