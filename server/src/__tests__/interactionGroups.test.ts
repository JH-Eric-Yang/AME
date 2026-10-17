import { describe, it, expect } from "vitest";
import {
  computeRoundRobinRotations,
  getInteractionGroup,
  computeRotationIndex,
  validateRotation,
} from "ame-shared/interactionGroups";
import type { RoutineConfig, InteractionPattern } from "ame-shared";

describe("computeRoundRobinRotations", () => {
  it("generates 3 rotations for 4 seats with pairs", () => {
    const rotations = computeRoundRobinRotations(4, 2);
    expect(rotations).toHaveLength(3);

    for (const rotation of rotations) {
      expect(rotation).toHaveLength(2);
      for (const group of rotation) {
        expect(group).toHaveLength(2);
      }
    }
  });

  it("covers all possible pairs for 4 seats", () => {
    const rotations = computeRoundRobinRotations(4, 2);
    const allPairs = rotations.flat().map((g) => g.sort((a, b) => a - b).join(","));
    const uniquePairs = new Set(allPairs);
    expect(uniquePairs.size).toBe(6);
  });

  it("generates rotations for 6 seats with groups of 3", () => {
    const rotations = computeRoundRobinRotations(6, 3);
    expect(rotations).toHaveLength(5);

    for (const rotation of rotations) {
      expect(rotation).toHaveLength(2);
      for (const group of rotation) {
        expect(group).toHaveLength(3);
      }
    }
  });

  it("returns single group when seatCount equals groupSize", () => {
    const rotations = computeRoundRobinRotations(4, 4);
    for (const rotation of rotations) {
      expect(rotation).toHaveLength(1);
      expect(rotation[0].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    }
  });

  it("returns single group fallback for invalid input", () => {
    const rotations = computeRoundRobinRotations(3, 2);
    expect(rotations).toHaveLength(1);
    expect(rotations[0]).toHaveLength(1);
    expect(rotations[0][0]).toEqual([0, 1, 2]);
  });
});

describe("getInteractionGroup", () => {
  it("returns all seats for 'all' pattern", () => {
    const pattern: InteractionPattern = { type: "all" };
    const result = getInteractionGroup(pattern, 1, 4, 0);
    expect(result.groupPeers).toEqual([0, 1, 2, 3]);
    expect(result.groupIndex).toBe(0);
  });

  it("returns correct fixed group for a seat", () => {
    const pattern: InteractionPattern = { type: "fixed", groups: [[0, 1], [2, 3]] };
    expect(getInteractionGroup(pattern, 0, 4, 0).groupPeers).toEqual([0, 1]);
    expect(getInteractionGroup(pattern, 2, 4, 0).groupPeers).toEqual([2, 3]);
    expect(getInteractionGroup(pattern, 0, 4, 0).groupIndex).toBe(0);
    expect(getInteractionGroup(pattern, 3, 4, 0).groupIndex).toBe(1);
  });

  it("rotates groups for round-robin pattern", () => {
    const pattern: InteractionPattern = { type: "round-robin", groupSize: 2 };

    const r0 = getInteractionGroup(pattern, 0, 4, 0);
    const r1 = getInteractionGroup(pattern, 0, 4, 1);
    const r2 = getInteractionGroup(pattern, 0, 4, 2);

    const partners = [r0.groupPeers, r1.groupPeers, r2.groupPeers];
    const partnerSets = partners.map((p) => p.filter((s) => s !== 0).join(","));
    expect(new Set(partnerSets).size).toBe(3);
  });

  it("wraps rotation index for round-robin", () => {
    const pattern: InteractionPattern = { type: "round-robin", groupSize: 2 };
    const r0 = getInteractionGroup(pattern, 0, 4, 0);
    const r3 = getInteractionGroup(pattern, 0, 4, 3);
    expect(r0.groupPeers).toEqual(r3.groupPeers);
  });

  describe("sequence pattern", () => {
    /** Four seats, three trials — every seat is assigned in every step. */
    const SeatCount = 4;
    const FourSeatSteps: number[][][] = [
      [
        [0, 1],
        [2, 3],
      ],
      [
        [0, 2],
        [1, 3],
      ],
      [
        [0, 3],
        [1, 2],
      ],
    ];

    const sequence = (steps: number[][][]): InteractionPattern => ({
      type: "sequence",
      steps,
    });

    it("returns the step group containing the seat", () => {
      const result = getInteractionGroup(
        sequence(FourSeatSteps),
        2,
        SeatCount,
        0,
      );
      expect(result.groupPeers).toEqual([2, 3]);
      expect(result.groupIndex).toBe(1);
    });

    it("selects a different step for each rotation index", () => {
      const partnersAt = (rotationIndex: number) =>
        getInteractionGroup(
          sequence(FourSeatSteps),
          0,
          SeatCount,
          rotationIndex,
        ).groupPeers.filter((s) => s !== 0);

      expect(partnersAt(0)).toEqual([1]);
      expect(partnersAt(1)).toEqual([2]);
      expect(partnersAt(2)).toEqual([3]);
    });

    it("wraps the rotation index past the end of the step list", () => {
      const first = getInteractionGroup(sequence(FourSeatSteps), 1, SeatCount, 0);
      const wrapped = getInteractionGroup(
        sequence(FourSeatSteps),
        1,
        SeatCount,
        FourSeatSteps.length,
      );
      expect(wrapped).toEqual(first);
    });

    it("wraps a negative rotation index onto the last step", () => {
      const last = getInteractionGroup(
        sequence(FourSeatSteps),
        1,
        SeatCount,
        FourSeatSteps.length - 1,
      );
      const negative = getInteractionGroup(
        sequence(FourSeatSteps),
        1,
        SeatCount,
        -1,
      );
      expect(negative).toEqual(last);
    });

    it("returns every seat's group consistently within one step", () => {
      const groupsAtFirstStep = [0, 1, 2, 3].map(
        (seat) => getInteractionGroup(sequence(FourSeatSteps), seat, SeatCount, 0),
      );
      expect(groupsAtFirstStep.map((g) => g.groupPeers)).toEqual([
        [0, 1],
        [0, 1],
        [2, 3],
        [2, 3],
      ]);
      expect(groupsAtFirstStep.map((g) => g.groupIndex)).toEqual([0, 0, 1, 1]);
    });

    it("leaves a seat solo when the step assigns it no group", () => {
      const unevenSteps: number[][][] = [[[0, 1]]];
      const result = getInteractionGroup(
        sequence(unevenSteps),
        3,
        SeatCount,
        0,
      );
      expect(result.groupPeers).toEqual([3]);
      expect(result.groupIndex).toBe(0);
    });

    it("leaves a seat solo when the step list is empty", () => {
      const result = getInteractionGroup(sequence([]), 1, SeatCount, 0);
      expect(result.groupPeers).toEqual([1]);
      expect(result.groupIndex).toBe(0);
    });
  });
});

describe("computeRotationIndex", () => {
  it("counts round-robin routines between match and current progress", () => {
    const routines = [
      { name: "consent", type: "routine-consent" },
      { name: "match", type: "routine-card", matching: { strategy: "fifo", slots: [] } },
      { name: "survey", type: "routine-survey" },
      { name: "chat1", type: "routine-video-chat", interactionPattern: { type: "round-robin", groupSize: 2 } },
      { name: "break", type: "routine-card" },
      { name: "chat2", type: "routine-video-chat", interactionPattern: { type: "round-robin", groupSize: 2 } },
    ] as unknown as RoutineConfig[];

    expect(computeRotationIndex(routines, 1, 3)).toBe(0);
    expect(computeRotationIndex(routines, 1, 5)).toBe(1);
  });

  it("returns 0 when no round-robin routines before current", () => {
    const routines = [
      { name: "match", type: "routine-card", matching: { strategy: "fifo", slots: [] } },
      { name: "chat", type: "routine-video-chat", interactionPattern: { type: "round-robin", groupSize: 2 } },
    ] as unknown as RoutineConfig[];

    expect(computeRotationIndex(routines, 0, 1)).toBe(0);
  });
});

describe("validateRotation", () => {
  it("returns null for a cohort that divides evenly into groups", () => {
    expect(validateRotation(8, 2)).toBeNull();
    expect(validateRotation(6, 3)).toBeNull();
    expect(validateRotation(2, 2)).toBeNull();
  });

  it("names both numbers when the cohort cannot be split evenly", () => {
    expect(validateRotation(7, 2)).toBe(
      "Cohort of 7 cannot be split into groups of 2",
    );
    expect(validateRotation(9, 2)).toBe(
      "Cohort of 9 cannot be split into groups of 2",
    );
  });

  it("rejects a cohort too small to form any group", () => {
    expect(validateRotation(1, 2)).toBe(
      "Cohort of 1 is too small to form interaction groups (need at least 2)",
    );
    expect(validateRotation(0, 2)).toBe(
      "Cohort of 0 is too small to form interaction groups (need at least 2)",
    );
  });

  it("rejects a group size that leaves every participant alone", () => {
    expect(validateRotation(8, 1)).toBe(
      "Group size of 1 leaves every participant alone (need at least 2)",
    );
  });

  it("rejects a group larger than the cohort", () => {
    expect(validateRotation(2, 4)).toBe(
      "Group size of 4 exceeds the cohort of 2",
    );
  });

  it("flags the case computeRoundRobinRotations degrades on, without changing it", () => {
    // computeRoundRobinRotations runs in a hot path where a throw would 500 a
    // participant, so it must keep returning a single all-seats group (B8).
    expect(computeRoundRobinRotations(7, 2)).toEqual([[[0, 1, 2, 3, 4, 5, 6]]]);
    expect(validateRotation(7, 2)).not.toBeNull();
  });
});
