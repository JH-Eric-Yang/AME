import { describe, it, expect } from "vitest";
import {
  readSeatRow,
  reseedRowText,
  trialSentenceLabel,
  seedStepsFromRoundRobin,
  appendTrial,
  removeTrial,
  MaxTrialCount,
} from "$lib/admin/seatGroups";

/** Distinct seats touched by a step, used to assert a step covers the cohort. */
function distinctSeats(step: number[][]): number {
  return new Set(step.flat()).size;
}

describe("trialSentenceLabel", () => {
  it("expands the compact column label used in the table", () => {
    expect(trialSentenceLabel("T4")).toBe("Trial 4");
    expect(trialSentenceLabel("T12")).toBe("Trial 12");
  });

  it("passes a label it does not recognise through verbatim", () => {
    expect(trialSentenceLabel("Warm-up")).toBe("Warm-up");
  });
});

describe("readSeatRow", () => {
  it("reads a complete 1-based row into 0-based groups", () => {
    const row = readSeatRow("1-8, 2-7, 3-6, 4-5", 8, "T1");

    expect(row.groups).toEqual([
      [0, 7],
      [1, 6],
      [2, 5],
      [3, 4],
    ]);
    expect(row.badge).toBe("8 of 8");
    expect(row.badgeOk).toBe(true);
    expect(row.headline).toBeNull();
    expect(row.detail).toBeNull();
    expect(row.blockingIssues).toEqual([]);
    expect(row.canEmit).toBe(true);
  });

  it("counts distinct seats, so a row that pairs one seat twice reads short", () => {
    // The broken row from design/ExplicitTable.dc.html: seat 6 unassigned, seat 3 twice.
    const row = readSeatRow("1-4, 3-5, 3-8, 7-2", 8, "T4");

    expect(row.badge).toBe("7 of 8");
    expect(row.badgeOk).toBe(false);
    expect(row.headline).toBe(
      "Trial 4 leaves seat 6 unassigned and pairs seat 3 twice.",
    );
    expect(row.detail).toBe(
      "Every seat must appear exactly once per trial. Seat 6 has no partner; seat 3 appears in 3-5 and 3-8.",
    );
  });

  it("still emits a coverage-broken row, and says the complaint only once", () => {
    // Coverage is blocking at Apply time, not at keystroke time. The duplicate
    // and unassigned messages live in headline/detail, never also in the list.
    const row = readSeatRow("1-4, 3-5, 3-8, 7-2", 8, "T4");

    expect(row.canEmit).toBe(true);
    expect(row.blockingIssues).toEqual([]);
  });

  it("blocks a seat outside the cohort without repeating the coverage complaint", () => {
    const row = readSeatRow("1-9, 2-7, 3-6, 4-5", 8, "T1");

    expect(row.canEmit).toBe(false);
    expect(row.blockingIssues).toEqual(["Seat 9 is outside the cohort of 8"]);
    expect(row.headline).toBe("Trial 1 leaves seat 8 unassigned.");
  });

  it("lists every unassigned seat when several are missing", () => {
    const row = readSeatRow("1-8, 2-3", 8, "T2");

    expect(row.badge).toBe("4 of 8");
    expect(row.headline).toBe("Trial 2 leaves seats 4, 5, 6 and 7 unassigned.");
  });

  it("says more than once when a seat appears three times", () => {
    const row = readSeatRow("1-3, 3-5, 3-7, 2-4, 6-8", 8, "T1");

    expect(row.badgeOk).toBe(false);
    expect(row.headline).toBe("Trial 1 assigns seat 3 more than once.");
  });

  it("reports an empty row as covering no seats", () => {
    const row = readSeatRow("", 8, "T1");

    expect(row.groups).toEqual([]);
    expect(row.badge).toBe("0 of 8");
    expect(row.badgeOk).toBe(false);
    expect(row.headline).toContain("unassigned");
    expect(row.canEmit).toBe(true);
  });

  it("refuses to emit while the text does not parse, and surfaces the reason", () => {
    // Mid-keystroke: "3-" is not yet a pair.
    const row = readSeatRow("1-8, 2-7, 3-", 8, "T1");

    expect(row.canEmit).toBe(false);
    expect(row.badgeOk).toBe(false);
    expect(row.blockingIssues).toEqual(['"" is not a seat number in "3-"']);
  });
});

describe("reseedRowText", () => {
  it("returns null when the incoming groups are what is already typed", () => {
    expect(
      reseedRowText("1-8, 2-7, 3-6, 4-5", [
        [0, 7],
        [1, 6],
        [2, 5],
        [3, 4],
      ]),
    ).toBeNull();
  });

  it("returns the formatted text when the parent replaced the groups", () => {
    expect(
      reseedRowText("1-8, 2-7, 3-6, 4-5", [
        [0, 1],
        [2, 7],
        [3, 6],
        [4, 5],
      ]),
    ).toBe("1-2, 3-8, 4-7, 5-6");
  });
});

describe("seedStepsFromRoundRobin", () => {
  it("seeds a full round-robin in which every step covers the cohort", () => {
    const steps = seedStepsFromRoundRobin(8, 2, 7);

    expect(steps).toHaveLength(7);
    for (const step of steps) {
      expect(step).toHaveLength(4);
      expect(distinctSeats(step)).toBe(8);
    }
  });

  it("wraps rather than emitting empty rows when more trials are asked for", () => {
    const steps = seedStepsFromRoundRobin(8, 2, 9);

    expect(steps).toHaveLength(9);
    expect(steps[7]).toEqual(steps[0]);
    expect(steps[8]).toEqual(steps[1]);
  });

  it("copies each step, so editing a wrapped row does not edit its twin", () => {
    const steps = seedStepsFromRoundRobin(8, 2, 9);
    steps[7][0][0] = 99;

    expect(steps[0][0][0]).not.toBe(99);
  });
});

describe("appendTrial", () => {
  it("appends the rotation that follows the rows already present", () => {
    const seeded = seedStepsFromRoundRobin(8, 2, 3);
    const grown = appendTrial(seeded, 8, 2);

    expect(grown).toHaveLength(4);
    expect(grown[3]).toEqual(seedStepsFromRoundRobin(8, 2, 4)[3]);
    expect(seeded).toHaveLength(3);
  });

  it("refuses to grow past the ceiling", () => {
    const full = seedStepsFromRoundRobin(8, 2, MaxTrialCount);
    expect(appendTrial(full, 8, 2)).toHaveLength(MaxTrialCount);
  });
});

describe("removeTrial", () => {
  it("removes the row at the given index without touching the rest", () => {
    const seeded = seedStepsFromRoundRobin(8, 2, 3);
    const shrunk = removeTrial(seeded, 1);

    expect(shrunk).toHaveLength(2);
    expect(shrunk[0]).toEqual(seeded[0]);
    expect(shrunk[1]).toEqual(seeded[2]);
  });

  it("keeps the last row, so the table can never become empty", () => {
    const single = seedStepsFromRoundRobin(8, 2, 1);
    expect(removeTrial(single, 0)).toEqual(single);
  });

  it("ignores an index outside the table", () => {
    const seeded = seedStepsFromRoundRobin(8, 2, 3);
    expect(removeTrial(seeded, 7)).toEqual(seeded);
    expect(removeTrial(seeded, -1)).toEqual(seeded);
  });
});
