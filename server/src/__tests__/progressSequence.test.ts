import { describe, it, expect } from "vitest";
import type { RoutineConfig, RoutineType } from "ame-shared";
import {
  stepsFor,
  matchingBands,
  shuffledRanges,
  bandAt,
  rangeAt,
  groupSizeAt,
  type SequenceRow,
} from "ame-shared/progressSequence";

const routine = (name: string, type: RoutineType, extra: Partial<RoutineConfig> = {}): RoutineConfig => ({
  name, type, layout: { rows: [] }, elements: [], ...extra,
});

const row = (p: Partial<SequenceRow> & { progress: number; routine: string }): SequenceRow => ({
  trialNumber: 1, condition: "Basic", content: {}, description: null, ...p,
});

const routines: RoutineConfig[] = [
  routine("intro", "routine-card"),
  routine("match", "routine-matching", { matching: { strategy: "fifo", slots: [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }] } }),
  routine("chat", "routine-video-chat", { interactionPattern: { type: "round-robin", groupSize: 2 } }),
  routine("end-match", "routine-end-matching"),
  routine("bye", "routine-end"),
];

// intro(0) match(1) chat×3 (2,3,4 = trials 1..3) end-match(5) bye(6); a stray Other-condition row.
const rows: SequenceRow[] = [
  row({ progress: 0, routine: "intro" }),
  row({ progress: 1, routine: "match" }),
  row({ progress: 2, routine: "chat", trialNumber: 1 }),
  row({ progress: 3, routine: "chat", trialNumber: 2 }),
  row({ progress: 4, routine: "chat", trialNumber: 3 }),
  row({ progress: 5, routine: "end-match" }),
  row({ progress: 6, routine: "bye", description: "block:abc:6" }),
  row({ progress: 0, routine: "intro", condition: "Other" }),
];

describe("stepsFor", () => {
  it("returns one step per progress of the condition, in order, pointing at input row indices", () => {
    const steps = stepsFor(rows, "Basic");
    expect(steps.map((s) => [s.position, s.trial, s.routine, s.rowIndex])).toEqual([
      [0, 1, "intro", 0], [1, 1, "match", 1], [2, 1, "chat", 2], [3, 2, "chat", 3],
      [4, 3, "chat", 4], [5, 1, "end-match", 5], [6, 1, "bye", 6],
    ]);
    expect(stepsFor(rows, "Other")).toHaveLength(1);
  });

  it("keeps the lowest trial row as the step and lists the others as extras", () => {
    const dup = [...rows, row({ progress: 2, routine: "chat", trialNumber: 9 })];
    const step = stepsFor(dup, "Basic").find((s) => s.position === 2)!;
    expect(step.rowIndex).toBe(2);
    expect(step.extraRowIndices).toEqual([8]);
  });

  it("marks block-generated rows", () => {
    const steps = stepsFor(rows, "Basic");
    expect(steps[6].generated).toBe(true);
    expect(steps[0].generated).toBe(false);
  });

  it("does not renumber a gappy legacy sequence", () => {
    const gappy = [row({ progress: 0, routine: "intro" }), row({ progress: 5, routine: "bye" })];
    expect(stepsFor(gappy, "Basic").map((s) => s.position)).toEqual([0, 5]);
  });
});

describe("matchingBands", () => {
  it("opens at a matching routine and closes at end-matching, with cohort and group sizes", () => {
    const bands = matchingBands(stepsFor(rows, "Basic"), routines);
    expect(bands).toEqual([
      { from: 1, to: 5, matchRoutine: "match", cohortSize: 4, groupSize: 2, pattern: { type: "round-robin", groupSize: 2 } },
    ]);
  });

  it("leaves an unclosed band open to the last step and falls back to cohort size", () => {
    const open = [row({ progress: 0, routine: "match" }), row({ progress: 1, routine: "intro" })];
    expect(matchingBands(stepsFor(open, "Basic"), routines)).toEqual([
      { from: 0, to: 1, matchRoutine: "match", cohortSize: 4, groupSize: 4, pattern: null },
    ]);
  });

  it("uses the longest group for fixed and sequence patterns", () => {
    const fixed = routine("chat", "routine-video-chat", { interactionPattern: { type: "fixed", groups: [[0, 1, 2], [3]] } });
    const bands = matchingBands(stepsFor(rows, "Basic"), [routines[1], fixed, routines[3]]);
    expect(bands[0].groupSize).toBe(3);
  });

  it("returns no band when no step has a matching routine", () => {
    expect(matchingBands(stepsFor(rows, "Other"), routines)).toEqual([]);
  });

  it("opens a band with the matching routine's own interaction pattern", () => {
    const matchWithPattern = routine("match", "routine-matching", {
      matching: { strategy: "fifo", slots: [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }] },
      interactionPattern: { type: "fixed", groups: [[0, 1], [2, 3]] },
    });
    const bands = matchingBands(stepsFor(rows, "Basic"), [matchWithPattern, routines[2], routines[3]]);
    expect(bands[0].pattern).toEqual({ type: "fixed", groups: [[0, 1], [2, 3]] });
    expect(bands[0].groupSize).toBe(2);
  });
});

describe("shuffledRanges", () => {
  it("maps trial ranges onto the positions that carry those trials", () => {
    const ranges = shuffledRanges(stepsFor(rows, "Basic"), [{ fromTrial: 2, toTrial: 3, method: "shuffle" }]);
    expect(ranges).toEqual([{ from: 3, to: 4, positions: [3, 4], trials: [2, 3], method: "shuffle" }]);
  });

  it("drops a range no step falls in", () => {
    expect(shuffledRanges(stepsFor(rows, "Basic"), [{ fromTrial: 7, toTrial: 9, method: "shuffle" }])).toEqual([]);
  });

  it("includes every step whose trial number falls in the range", () => {
    const ranges = shuffledRanges(stepsFor(rows, "Basic"), [{ fromTrial: 1, toTrial: 1, method: "shuffle" }]);
    expect(ranges).toEqual([
      { from: 0, to: 6, positions: [0, 1, 2, 5, 6], trials: [1], method: "shuffle" },
    ]);
  });
});

describe("bandAt / rangeAt / groupSizeAt", () => {
  const steps = stepsFor(rows, "Basic");
  const bands = matchingBands(steps, routines);
  const ranges = shuffledRanges(steps, [{ fromTrial: 2, toTrial: 3, method: "latin-square" }]);

  it("finds the band and range containing a position, inclusive at both ends", () => {
    expect(bandAt(bands, 1)?.matchRoutine).toBe("match");
    expect(bandAt(bands, 5)?.matchRoutine).toBe("match");
    expect(bandAt(bands, 6)).toBeNull();
    expect(rangeAt(ranges, 3)?.trials).toEqual([2, 3]);
    expect(rangeAt(ranges, 2)).toBeNull();
    expect(rangeAt(ranges, 5)).toBeNull();
  });

  it("prefers the routine's own interaction pattern over the band's", () => {
    const solo = routine("x", "routine-card", { interactionPattern: { type: "fixed", groups: [[0, 1, 2, 3]] } });
    expect(groupSizeAt(bands[0], solo)).toBe(4);
    expect(groupSizeAt(bands[0], routines[0])).toBe(2);
  });
});
