import { describe, it, expect } from "vitest";
import {
  activeMembers,
  activeParticipantIds,
  hasActiveMembers,
} from "../socket/sessionMembership.js";

const CohortSize = 8;

/** An eight-seat cohort; seats listed in `droppedSeats` have left. */
function makeCohort(droppedSeats: number[] = []) {
  return Array.from({ length: CohortSize }, (_, seat) => ({
    participantId: `p${seat}`,
    seat,
    status: droppedSeats.includes(seat) ? ("DROPPED" as const) : ("ACTIVE" as const),
  }));
}

describe("sessionMembership", () => {
  describe("activeMembers", () => {
    it("keeps every seat when nobody has dropped", () => {
      expect(activeMembers(makeCohort())).toHaveLength(CohortSize);
    });

    it("drops the departed seat and preserves the seat number of the rest", () => {
      const remaining = activeMembers(makeCohort([7]));
      expect(remaining).toHaveLength(CohortSize - 1);
      expect(remaining.map((m) => m.seat)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it("keeps caller-supplied extra fields intact", () => {
      const withSlot = [
        { participantId: "p0", seat: 0, status: "ACTIVE" as const, slotName: "asker" },
        { participantId: "p1", seat: 1, status: "DROPPED" as const, slotName: "answerer" },
      ];
      expect(activeMembers(withSlot)).toEqual([withSlot[0]]);
    });
  });

  describe("activeParticipantIds", () => {
    it("excludes the dropped participant", () => {
      const ids = activeParticipantIds(makeCohort([7]));
      expect(ids).toEqual(["p0", "p1", "p2", "p3", "p4", "p5", "p6"]);
      expect(ids).not.toContain("p7");
    });

    it("is empty once every seat has dropped", () => {
      expect(activeParticipantIds(makeCohort([0, 1, 2, 3, 4, 5, 6, 7]))).toEqual([]);
    });
  });

  describe("hasActiveMembers", () => {
    it("is true while one seat is still occupied", () => {
      expect(hasActiveMembers(makeCohort([0, 1, 2, 3, 4, 5, 6]))).toBe(true);
    });

    it("is false once every seat has dropped", () => {
      expect(hasActiveMembers(makeCohort([0, 1, 2, 3, 4, 5, 6, 7]))).toBe(false);
    });

    it("is false for a session with no members at all", () => {
      expect(hasActiveMembers([])).toBe(false);
    });
  });
});
