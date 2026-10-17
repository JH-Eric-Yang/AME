import { describe, it, expect } from "vitest";
import type { RoutineConfig, RoutineType } from "ame-shared";
import { stepsFor, matchingBands, shuffledRanges, type SequenceRow } from "ame-shared/progressSequence";
import { gutterCells, bandLabel } from "../sequenceGutter";

const routine = (name: string, type: RoutineType, extra: Partial<RoutineConfig> = {}): RoutineConfig => ({
  name, type, layout: { rows: [] }, elements: [], ...extra,
});
const row = (p: Partial<SequenceRow> & { progress: number; routine: string }): SequenceRow => ({
  trialNumber: 1, condition: "Basic", content: {}, description: null, ...p,
});
const routines = [
  routine("intro", "routine-card"),
  routine("match", "routine-matching", { matching: { strategy: "fifo", slots: [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }] } }),
  routine("chat", "routine-video-chat", { interactionPattern: { type: "round-robin", groupSize: 2 } }),
  routine("end-match", "routine-end-matching"),
  routine("bye", "routine-end"),
];
const rows = [
  row({ progress: 0, routine: "intro" }), row({ progress: 1, routine: "match" }),
  row({ progress: 2, routine: "chat", trialNumber: 2 }), row({ progress: 3, routine: "chat", trialNumber: 3 }),
  row({ progress: 4, routine: "end-match" }), row({ progress: 5, routine: "bye" }),
];
const steps = stepsFor(rows, "Basic");
const bands = matchingBands(steps, routines);
const ranges = shuffledRanges(steps, [{ fromTrial: 2, toTrial: 3, method: "shuffle" }]);

describe("gutterCells", () => {
  it("marks band start/mid/end, rotation index and shuffled span per step", () => {
    expect(gutterCells(steps, bands, ranges, routines)).toEqual([
      { position: 0, band: null, bandLabel: null, rotation: null, shuffled: null },
      { position: 1, band: "start", bandLabel: "4 seats · round-robin dyads", rotation: null, shuffled: null },
      { position: 2, band: "mid", bandLabel: null, rotation: 1, shuffled: "start" },
      { position: 3, band: "mid", bandLabel: null, rotation: 2, shuffled: "end" },
      { position: 4, band: "end", bandLabel: null, rotation: null, shuffled: null },
      { position: 5, band: null, bandLabel: null, rotation: null, shuffled: null },
    ]);
  });

  it("uses solo for a one-step band or range", () => {
    const solo = stepsFor([row({ progress: 0, routine: "match" })], "Basic");
    expect(gutterCells(solo, matchingBands(solo, routines), [], routines)[0].band).toBe("solo");
  });
});

describe("bandLabel", () => {
  it("names the pattern", () => {
    expect(bandLabel({ ...bands[0], pattern: { type: "fixed", groups: [[0, 1], [2, 3]] } })).toBe("4 seats · fixed groups");
    expect(bandLabel({ ...bands[0], pattern: { type: "all" }, groupSize: 4 })).toBe("4 seats · all together");
    expect(bandLabel({ ...bands[0], pattern: { type: "round-robin", groupSize: 3 }, groupSize: 3 })).toBe("4 seats · round-robin groups of 3");
    expect(bandLabel({ ...bands[0], pattern: null, groupSize: 4 })).toBe("4 seats");
  });
});
