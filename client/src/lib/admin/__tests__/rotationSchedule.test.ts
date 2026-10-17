import { describe, it, expect } from "vitest";
import type { InteractionPattern, RoutineConfig } from "ame-shared";
import type { SessionDesignIssue } from "ame-shared/sessionDesign";
import {
  patternKindOf,
  groupSizeOf,
  groupSizeOptions,
  groupSizeName,
  groupSizeLabel,
  fullRoundRobinTrials,
  isFullRoundRobin,
  routineOptions,
  interTrialRoutineOptions,
  progressStride,
  buildScheduleGrid,
  patternPatch,
  groupSizePatch,
  trialsPatch,
  issuesForField,
  issuesForStep,
  unplacedIssues,
  SoloCellText,
} from "$lib/admin/rotationSchedule";

/** Circle method for 4 seats in dyads: 3 trials covering all 6 pairs once. */
const FourSeatSteps: number[][][] = [
  [
    [0, 3],
    [1, 2],
  ],
  [
    [0, 1],
    [2, 3],
  ],
  [
    [0, 2],
    [1, 3],
  ],
];

const routine = (name: string, type: RoutineConfig["type"]): RoutineConfig => ({
  name,
  type,
  layout: { rows: [] },
  elements: [],
});

describe("patternKindOf", () => {
  it("defaults to round-robin when the design carries no pattern", () => {
    expect(patternKindOf(undefined)).toBe("round-robin");
  });

  it("reads the stored pattern type", () => {
    expect(patternKindOf({ type: "sequence", steps: FourSeatSteps })).toBe("sequence");
  });
});

describe("groupSizeOf", () => {
  it("reads the group size straight off a round-robin pattern", () => {
    expect(groupSizeOf({ type: "round-robin", groupSize: 4 })).toBe(4);
  });

  it("infers the group size from the first group of a fixed pattern", () => {
    expect(
      groupSizeOf({
        type: "fixed",
        groups: [
          [0, 1, 2],
          [3, 4, 5],
        ],
      }),
    ).toBe(3);
  });

  it("falls back to dyads for a pattern that has no groups", () => {
    expect(groupSizeOf({ type: "all" })).toBe(2);
  });
});

describe("groupSizeOptions", () => {
  it("offers the proper divisors of the cohort", () => {
    expect(groupSizeOptions(8)).toEqual([2, 4]);
    expect(groupSizeOptions(6)).toEqual([2, 3]);
  });

  it("offers only triads for a cohort of nine", () => {
    expect(groupSizeOptions(9)).toEqual([3]);
  });

  it("offers the whole cohort when nothing smaller divides it", () => {
    expect(groupSizeOptions(2)).toEqual([2]);
    expect(groupSizeOptions(5)).toEqual([5]);
  });
});

describe("group-size wording", () => {
  it("names dyads and triads, and counts anything larger", () => {
    expect(groupSizeName(2)).toBe("dyads");
    expect(groupSizeName(3)).toBe("triads");
    expect(groupSizeName(4)).toBe("groups of 4");
  });

  it("prefixes the number for the select option", () => {
    expect(groupSizeLabel(2)).toBe("2 — dyads");
    expect(groupSizeLabel(4)).toBe("4 — groups of 4");
  });
});

describe("full round-robin", () => {
  it("is cohortSize - 1 trials", () => {
    expect(fullRoundRobinTrials(8)).toBe(7);
    expect(fullRoundRobinTrials(2)).toBe(1);
  });

  it("recognises a design already pinned to a full round-robin", () => {
    const pattern: InteractionPattern = { type: "round-robin", groupSize: 2 };
    expect(isFullRoundRobin(pattern, 7, 8)).toBe(true);
    expect(isFullRoundRobin(pattern, 5, 8)).toBe(false);
    expect(isFullRoundRobin({ type: "all" }, 7, 8)).toBe(false);
  });
});

describe("routineOptions", () => {
  it("lists only routines of the requested type, in order", () => {
    const routines = [
      routine("Intro", "routine-card"),
      routine("Chat", "routine-video-chat"),
      routine("Chat B", "routine-video-chat"),
    ];
    expect(routineOptions(routines, "routine-video-chat", "Chat")).toEqual(["Chat", "Chat B"]);
  });

  it("keeps a selection that no longer matches any routine visible", () => {
    const routines = [routine("Chat", "routine-video-chat")];
    expect(routineOptions(routines, "routine-video-chat", "Deleted")).toEqual(["Chat", "Deleted"]);
  });
});

describe("interTrialRoutineOptions", () => {
  it("excludes the block's own matching routines", () => {
    const routines = [
      routine("Chat-match", "routine-matching"),
      routine("Chat", "routine-video-chat"),
      routine("Rating", "routine-survey"),
      routine("Chat-end-match", "routine-end-matching"),
    ];
    expect(interTrialRoutineOptions(routines)).toEqual(["Chat", "Rating"]);
  });

  it("offers nothing when only matching routines exist", () => {
    const routines = [
      routine("Chat-match", "routine-matching"),
      routine("Chat-end-match", "routine-end-matching"),
    ];
    expect(interTrialRoutineOptions(routines)).toEqual([]);
  });
});

describe("progressStride", () => {
  it("consumes a second progress only when a between-trials routine is set", () => {
    expect(progressStride(null)).toBe(1);
    expect(progressStride("Rating")).toBe(2);
  });
});

describe("buildScheduleGrid", () => {
  it("numbers one column per step and puts it at the progress it will run at", () => {
    const grid = buildScheduleGrid(FourSeatSteps, 4, 1, null);
    expect(grid.columns).toEqual([
      { trial: 1, label: "T1", progress: 2, progressLabel: "p2" },
      { trial: 2, label: "T2", progress: 3, progressLabel: "p3" },
      { trial: 3, label: "T3", progress: 4, progressLabel: "p4" },
    ]);
  });

  it("strides two progresses per trial when a between-trials routine is set", () => {
    const grid = buildScheduleGrid(FourSeatSteps, 4, 1, "Rating");
    expect(grid.columns.map((c) => c.progress)).toEqual([2, 4, 6]);
  });

  it("shows one 1-based partner seat per cell", () => {
    const grid = buildScheduleGrid(FourSeatSteps, 4, 1, null);
    expect(grid.rows.map((r) => r.label)).toEqual(["Seat 1", "Seat 2", "Seat 3", "Seat 4"]);
    expect(grid.rows.map((r) => r.cells)).toEqual([
      ["4", "2", "3"],
      ["3", "1", "4"],
      ["2", "4", "1"],
      ["1", "3", "2"],
    ]);
  });

  it("lists every partner for a group larger than a dyad", () => {
    const grid = buildScheduleGrid([[[0, 1, 2]]], 3, 1, null);
    expect(grid.rows[0].cells).toEqual(["2, 3"]);
  });

  it("marks a seat that no group contains as sitting out", () => {
    const grid = buildScheduleGrid([[[0, 1]]], 3, 1, null);
    expect(grid.rows[2].cells).toEqual([SoloCellText]);
  });
});

describe("patternPatch", () => {
  it("carries the chosen group size onto a round-robin", () => {
    expect(patternPatch("round-robin", 4, FourSeatSteps)).toEqual({
      pattern: { type: "round-robin", groupSize: 4 },
    });
  });

  it("seeds an explicit table from the steps currently on screen", () => {
    const patch = patternPatch("sequence", 2, FourSeatSteps);
    expect(patch).toEqual({ pattern: { type: "sequence", steps: FourSeatSteps } });
    if (patch.pattern.type !== "sequence") throw new Error("expected a sequence pattern");
    patch.pattern.steps[0][0][0] = 99;
    expect(FourSeatSteps[0][0][0]).toBe(0);
  });

  it("seeds fixed groups from the first step", () => {
    expect(patternPatch("fixed", 2, FourSeatSteps)).toEqual({
      pattern: {
        type: "fixed",
        groups: [
          [0, 3],
          [1, 2],
        ],
      },
    });
  });

  it("drops all grouping for everyone-together", () => {
    expect(patternPatch("all", 2, FourSeatSteps)).toEqual({ pattern: { type: "all" } });
  });
});

describe("groupSizePatch", () => {
  it("changes only the group size of a round-robin", () => {
    expect(groupSizePatch("round-robin", 4, FourSeatSteps, 8, false)).toEqual({
      pattern: { type: "round-robin", groupSize: 4 },
    });
  });

  it("re-pins the trial count when the full round-robin box is ticked", () => {
    expect(groupSizePatch("round-robin", 2, FourSeatSteps, 8, true)).toEqual({
      pattern: { type: "round-robin", groupSize: 2 },
      trials: 7,
    });
  });

  it("keeps an authored explicit table instead of converting it to a round-robin", () => {
    expect(groupSizePatch("sequence", 4, FourSeatSteps, 4, false)).toEqual({
      pattern: { type: "sequence", steps: FourSeatSteps },
    });
  });

  it("never pins the trial count for a pattern that is not a round-robin", () => {
    expect(groupSizePatch("fixed", 4, FourSeatSteps, 4, true)).toEqual({
      pattern: {
        type: "fixed",
        groups: [
          [0, 3],
          [1, 2],
        ],
      },
    });
  });
});

describe("trialsPatch", () => {
  it("accepts a whole number of trials", () => {
    expect(trialsPatch(7)).toEqual({ trials: 7 });
  });

  it("leaves the design untouched for an emptied or zero input", () => {
    expect(trialsPatch(Number.NaN)).toBeNull();
    expect(trialsPatch(0)).toBeNull();
  });
});

describe("issue placement", () => {
  const issues: SessionDesignIssue[] = [
    {
      level: "error",
      message: "8 trials exceed the 7 rotations a cohort of 8 in dyads has.",
      field: "trials",
    },
    {
      level: "warning",
      message: "Chat carries its own matching config.",
      field: "trialRoutine",
    },
    { level: "error", message: "Seat 3 filters on an unknown property.", field: "seats.2" },
    { level: "error", message: "Trial 2 lists seat 5 twice.", field: "pattern.steps.1" },
    {
      level: "error",
      message: "A cohort of 7 cannot be split into groups of 2.",
      field: "cohortSize",
    },
    { level: "error", message: "This block overlaps another block's progress band." },
  ];

  it("selects the issues belonging to one header field without swallowing row issues", () => {
    expect(issuesForField(issues, "trials")).toEqual([issues[0]]);
    expect(issuesForField(issues, "pattern")).toEqual([]);
  });

  it("places an explicit-table row issue on its own row", () => {
    expect(issuesForStep(issues, 1)).toEqual([issues[3]]);
    expect(issuesForStep(issues, 0)).toEqual([]);
  });

  it("banners only what no control anywhere claims", () => {
    expect(unplacedIssues(issues)).toEqual([issues[5]]);
  });
});
