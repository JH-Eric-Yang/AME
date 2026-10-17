import { describe, it, expect, vi } from "vitest";
import type {
  RoutineConfig,
  SessionDesign,
  SessionDesignIssue,
} from "ame-shared/sessionDesign";
import {
  coverageMatrix,
  compileSessionDesign,
  defaultSessionDesign,
  diffCompiled,
  formatSeatGroups,
  parseSeatGroups,
  progressBand,
  stepsForDesign,
  validateSessionDesign,
} from "ame-shared/sessionDesign";
import { computeRoundRobinRotations } from "ame-shared/interactionGroups";
import {
  GeneratedDescriptionPrefix,
  isGeneratedRow,
} from "ame-shared/contentValidation";

/** The canonical study in the design doc: eight participants, dyads, seven trials. */
const CanonicalCohort = 8;
/** Mirrors `MaxScheduleTrials` in the module: the clamp a typo lands on. */
const MaxScheduleTrials = 500;

const makeDesign = (overrides: Partial<SessionDesign> = {}): SessionDesign => {
  const cohortSize = overrides.cohortSize ?? CanonicalCohort;
  return {
    version: 1,
    id: "blk1",
    label: "Chat block",
    cohortSize,
    strategy: "fifo",
    timeoutSeconds: 300,
    timeoutAction: "wait",
    seats: Array.from({ length: cohortSize }, (_, i) => ({ name: `seat-${i + 1}` })),
    pattern: { type: "round-robin", groupSize: 2 },
    trials: cohortSize - 1,
    trialRoutine: "Chat",
    interTrialRoutine: null,
    conditions: ["Basic"],
    startProgress: 1,
    matchRoutineName: "Chat-match",
    endMatchRoutineName: "Chat-end-match",
    partnerUnavailableText: "Your partner is no longer available.",
    trialContent: {},
    ...overrides,
  };
};

const makeRoutine = (overrides: Partial<RoutineConfig> & { name: string }): RoutineConfig => ({
  type: "routine-video-chat",
  layout: { rows: [{ columns: [{ span: 12 }] }] },
  elements: [],
  ...overrides,
});

/** A Builder that already holds the trial routine and nothing that trips a rule. */
const cleanRoutines = (): RoutineConfig[] => [makeRoutine({ name: "Chat" })];

describe("stepsForDesign", () => {
  it("returns one round-robin rotation per trial for 8 seats in dyads", () => {
    const steps = stepsForDesign(makeDesign());
    expect(steps).toHaveLength(7);
    expect(steps.every((groups) => groups.length === 4)).toBe(true);
    expect(steps).toEqual(computeRoundRobinRotations(CanonicalCohort, 2));
  });

  it("truncates to the requested number of trials", () => {
    const steps = stepsForDesign(makeDesign({ trials: 3 }));
    expect(steps).toEqual(computeRoundRobinRotations(CanonicalCohort, 2).slice(0, 3));
  });

  it("wraps modulo the rotation count, exactly as the runtime does", () => {
    const rotations = computeRoundRobinRotations(CanonicalCohort, 2);
    const steps = stepsForDesign(makeDesign({ trials: 9 }));
    expect(steps).toHaveLength(9);
    expect(steps[7]).toEqual(rotations[0]);
    expect(steps[8]).toEqual(rotations[1]);
  });

  it("returns an explicit sequence table verbatim", () => {
    const table = [
      [[0, 1], [2, 3]],
      [[0, 2], [1, 3]],
    ];
    const steps = stepsForDesign(
      makeDesign({ cohortSize: 4, trials: 99, pattern: { type: "sequence", steps: table } }),
    );
    expect(steps).toEqual(table);
  });

  it("repeats fixed groups, and puts everyone together for the all pattern", () => {
    const fixed = stepsForDesign(
      makeDesign({ cohortSize: 4, trials: 2, pattern: { type: "fixed", groups: [[0, 1], [2, 3]] } }),
    );
    expect(fixed).toEqual([[[0, 1], [2, 3]], [[0, 1], [2, 3]]]);

    const all = stepsForDesign(makeDesign({ cohortSize: 3, trials: 2, pattern: { type: "all" } }));
    expect(all).toEqual([[[0, 1, 2]], [[0, 1, 2]]]);
  });

  // `Array.from({ length })` throws RangeError above 2**32-1, and the validator
  // calls the compiler internally — so an unclamped typo took the whole apply
  // bar down with it instead of showing the "too many trials" error it had
  // already queued.
  it("clamps an implausible trial count instead of throwing", () => {
    expect(stepsForDesign(makeDesign({ trials: 1e10 }))).toHaveLength(MaxScheduleTrials);
    expect(stepsForDesign(makeDesign({ trials: Infinity }))).toHaveLength(MaxScheduleTrials);
    expect(stepsForDesign(makeDesign({ trials: NaN }))).toEqual([]);
  });

  // Later tasks start from this array and let a researcher edit one row, so no
  // trial may share a group array with another trial or with design.pattern.
  it("hands out independent arrays the caller may edit in place", () => {
    const table = [
      [[0, 1], [2, 3]],
      [[0, 2], [1, 3]],
    ];
    const sequence = stepsForDesign(
      makeDesign({ cohortSize: 4, trials: 2, pattern: { type: "sequence", steps: table } }),
    );
    sequence[0][0][0] = 99;
    expect(table[0][0][0]).toBe(0);

    const fixed = stepsForDesign(
      makeDesign({ cohortSize: 4, trials: 2, pattern: { type: "fixed", groups: [[0, 1], [2, 3]] } }),
    );
    fixed[0][0][0] = 99;
    expect(fixed[1][0][0]).toBe(0);

    const all = stepsForDesign(makeDesign({ cohortSize: 3, trials: 2, pattern: { type: "all" } }));
    all[0][0][0] = 99;
    expect(all[1][0][0]).toBe(0);

    const wrapped = stepsForDesign(makeDesign({ trials: 9 }));
    wrapped[0][0][0] = 99;
    expect(wrapped[7][0][0]).toBe(0);
  });
});

describe("coverageMatrix", () => {
  it("covers all 28 pairs exactly once for a full 8-seat round-robin", () => {
    const { pairs, total, met, repeats } = coverageMatrix(
      stepsForDesign(makeDesign()),
      CanonicalCohort,
    );
    expect(total).toBe(28);
    expect(met).toBe(28);
    expect(repeats).toBe(0);
    expect(pairs.get("0-7")).toEqual([1]);
  });

  it("leaves pairs unmet when the schedule is under-authored", () => {
    const { total, met, repeats } = coverageMatrix(
      stepsForDesign(makeDesign({ trials: 3 })),
      CanonicalCohort,
    );
    expect(total).toBe(28);
    expect(met).toBe(12);
    expect(repeats).toBe(0);
  });

  it("counts repeats when the schedule wraps past the last rotation", () => {
    const { met, repeats, pairs } = coverageMatrix(
      stepsForDesign(makeDesign({ trials: 9 })),
      CanonicalCohort,
    );
    expect(met).toBe(28);
    expect(repeats).toBe(8);
    expect(pairs.get("0-7")).toEqual([1, 8]);
  });
});

describe("formatSeatGroups / parseSeatGroups", () => {
  it("formats 0-based groups as 1-based text", () => {
    expect(formatSeatGroups(computeRoundRobinRotations(CanonicalCohort, 2)[0])).toBe(
      "1-8, 2-7, 3-6, 4-5",
    );
  });

  it("round-trips every rotation of the canonical schedule", () => {
    for (const rotation of computeRoundRobinRotations(CanonicalCohort, 2)) {
      const { groups, issues } = parseSeatGroups(formatSeatGroups(rotation), CanonicalCohort);
      expect(issues).toEqual([]);
      expect(groups).toEqual(rotation);
    }
  });

  // A chunk that failed to parse must not ALSO be reported as a lonely seat:
  // "1-9" is one complaint about seat 9, not a second one about seat 1.
  it("reports a seat outside the cohort without also calling its partner lonely", () => {
    const { issues } = parseSeatGroups("1-9, 2-7, 3-6, 4-5", CanonicalCohort);
    expect(issues).toEqual([
      "Seat 9 is outside the cohort of 8",
      "Seat 8 is not assigned",
    ]);
  });

  it("still reports a genuinely lonely seat when the chunk parsed cleanly", () => {
    const { issues } = parseSeatGroups("1, 2-7, 3-6, 4-5", CanonicalCohort);
    expect(issues).toEqual(["Seat 1 has no partner", "Seat 8 is not assigned"]);
  });

  it("reports a duplicated seat and an unassigned seat together", () => {
    const { issues } = parseSeatGroups("1-4, 3-5, 3-8, 7-2", CanonicalCohort);
    expect(issues).toEqual(["Seat 3 appears 2 times", "Seat 6 is not assigned"]);
  });

  it("reports a token that is not a seat number", () => {
    const { issues } = parseSeatGroups("1-x, 2-7, 3-6, 4-5", CanonicalCohort);
    expect(issues[0]).toContain('"x" is not a seat number');
    expect(issues.some((issue) => issue.includes("has no partner"))).toBe(false);
  });
});

describe("compileSessionDesign", () => {
  it("emits the match row, seven trial rows and the end-match row on consecutive progresses", () => {
    const { contentRows } = compileSessionDesign(makeDesign());
    expect(contentRows).toHaveLength(9);
    expect(contentRows.map((r) => r.progress)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(contentRows.map((r) => r.routine)).toEqual([
      "Chat-match",
      ...Array.from({ length: 7 }, () => "Chat"),
      "Chat-end-match",
    ]);
    expect(contentRows.slice(1, 8).map((r) => r.trialNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(contentRows.every((r) => r.condition === "Basic")).toBe(true);
  });

  // The Session Designer is the path researchers actually use, and re-applying
  // a block replaces its matching routine wholesale. A design that could not
  // carry an assignment would silently reset the routine to random on every
  // apply, so counterbalancing would be unauthorable through this path.
  it("compiles the design's assignment onto the matching routine", () => {
    const { routines } = compileSessionDesign(
      makeDesign({
        assignment: { mode: "counterbalanced", set: "rotation", order: "block-shuffled" },
      }),
    );

    const match = routines.find((r) => r.name === "Chat-match");
    expect(match?.matching?.assignment).toEqual({
      mode: "counterbalanced",
      set: "rotation",
      order: "block-shuffled",
    });
  });

  it("emits no assignment key for a design that carries none", () => {
    const { routines } = compileSessionDesign(makeDesign());

    const match = routines.find((r) => r.name === "Chat-match");
    // Absent, not `{ mode: "random" }`: the runtime default already governs,
    // and an explicit key would make every pre-existing block look edited.
    expect(match?.matching && "assignment" in match.matching).toBe(false);
  });

  it("stamps every row with its own block description", () => {
    const { contentRows } = compileSessionDesign(makeDesign());
    expect(contentRows.map((r) => r.description)).toEqual(
      Array.from({ length: 9 }, (_, k) => `block:blk1:${k}`),
    );
  });

  // The stamp and the prefix `replaceContent` deletes by must be ONE string.
  // If they drift, the delete matches nothing and every re-apply doubles the
  // block's rows instead of replacing them.
  it("stamps rows with the same marker isGeneratedRow and replaceContent match on", () => {
    const { contentRows } = compileSessionDesign(makeDesign());
    for (const row of contentRows) {
      expect(row.description.startsWith(GeneratedDescriptionPrefix)).toBe(true);
      expect(isGeneratedRow(row.description)).toBe(true);
    }
    // The trailing colon is what stops block "blk1" matching "blk10"'s rows.
    expect(contentRows[0].description).toBe(`${GeneratedDescriptionPrefix}blk1:0`);
  });

  it("puts the matching config on the match routine and never on the trial routine", () => {
    const { routines } = compileSessionDesign(makeDesign());
    expect(routines.map((r) => r.name)).toEqual(["Chat-match", "Chat", "Chat-end-match"]);

    const [match, trial, end] = routines;
    expect(match.type).toBe("routine-matching");
    expect(match.matching).toEqual({
      strategy: "fifo",
      slots: Array.from({ length: 8 }, (_, i) => ({ name: `seat-${i + 1}` })),
      timeout: 300,
      timeoutAction: "wait",
    });

    expect(trial.type).toBe("routine-video-chat");
    expect(trial.matching).toBeNull();
    expect(trial.interactionPattern).toEqual({ type: "round-robin", groupSize: 2 });
    expect(trial.config).toEqual({
      partnerUnavailableText: "Your partner is no longer available.",
    });

    expect(end.type).toBe("routine-end-matching");
    expect(end.matching).toBeNull();
  });

  it("reports the progress band and the cohort size to write onto the experiment", () => {
    const { band, participantsPerSession } = compileSessionDesign(makeDesign());
    expect(band).toEqual({
      fromProgress: 1,
      toProgress: 9,
      conditions: ["Basic"],
      blockId: "blk1",
    });
    expect(participantsPerSession).toBe(8);
  });

  // Stride 2: trial k sits at startProgress + 1 + (k-1)*2 when a between-trials
  // routine is set. The client's schedule grid and explicit table use the same rule.
  it("interleaves a between-trials routine without advancing the trial number", () => {
    const { contentRows, band } = compileSessionDesign(
      makeDesign({ cohortSize: 4, trials: 3, interTrialRoutine: "Rating" }),
    );
    expect(contentRows.map((r) => [r.progress, r.routine, r.trialNumber])).toEqual([
      [1, "Chat-match", 1],
      [2, "Chat", 1],
      [3, "Rating", 1],
      [4, "Chat", 2],
      [5, "Rating", 2],
      [6, "Chat", 3],
      [7, "Chat-end-match", 1],
    ]);
    expect(band.toProgress).toBe(7);
  });

  it("repeats the identical progress band for every condition", () => {
    const { contentRows, band } = compileSessionDesign(
      makeDesign({ trials: 2, conditions: ["A", "B"] }),
    );
    expect(contentRows).toHaveLength(8);
    expect(contentRows.filter((r) => r.condition === "A").map((r) => r.progress)).toEqual([1, 2, 3, 4]);
    expect(contentRows.filter((r) => r.condition === "B").map((r) => r.progress)).toEqual([1, 2, 3, 4]);
    expect(contentRows.map((r) => r.description)).toEqual(
      Array.from({ length: 8 }, (_, k) => `block:blk1:${k}`),
    );
    expect(band.conditions).toEqual(["A", "B"]);
  });

  it("attaches authored per-trial content to the matching trial row", () => {
    const { contentRows } = compileSessionDesign(
      makeDesign({ trials: 3, trialContent: { 2: { prompt: "Describe the image" } } }),
    );
    const trialRows = contentRows.filter((r) => r.routine === "Chat");
    expect(trialRows[0].content).toEqual({});
    expect(trialRows[1].content).toEqual({ prompt: "Describe the image" });
    expect(trialRows[2].content).toEqual({});
  });

  // The whole architectural argument for this module: the schedule and the rows
  // are emitted from one source, so they cannot drift apart.
  it("keeps trial rows and rotation steps in lockstep as the trial count changes", () => {
    for (const trials of [1, 3, 7]) {
      const design = makeDesign({ trials });
      const steps = stepsForDesign(design);
      const trialRows = compileSessionDesign(design).contentRows.filter(
        (r) => r.routine === design.trialRoutine,
      );
      expect(trialRows).toHaveLength(steps.length);
      expect(trialRows.map((r) => r.trialNumber)).toEqual(steps.map((_, i) => i + 1));
    }
  });

  it("follows an explicit table's own length rather than design.trials", () => {
    const design = makeDesign({
      cohortSize: 4,
      trials: 9,
      pattern: { type: "sequence", steps: [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]] },
    });
    const trialRows = compileSessionDesign(design).contentRows.filter((r) => r.routine === "Chat");
    expect(trialRows).toHaveLength(stepsForDesign(design).length);
    expect(trialRows.map((r) => r.trialNumber)).toEqual([1, 2, 3]);
  });
});

describe("validateSessionDesign", () => {
  it("passes the canonical design with no issues at all", () => {
    expect(validateSessionDesign(makeDesign(), cleanRoutines(), [])).toEqual([]);
  });

  it("blocks a cohort the group size does not divide, beside the cohort control", () => {
    const design = makeDesign({ cohortSize: 7, trials: 6 });
    const issues = validateSessionDesign(design, cleanRoutines(), []);
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("error");
    expect(issues[0].field).toBe("cohortSize");
    expect(issues[0].message).toContain("cannot be split into groups of 2");
  });

  // design/ApplyStates.dc.html is the authority for this string: the apply bar
  // splits it on the first ". " into headline and detail.
  it("words the blocked cohort exactly as design/ApplyStates.dc.html does", () => {
    const issues = validateSessionDesign(makeDesign({ cohortSize: 7, trials: 6 }), cleanRoutines(), []);
    expect(issues[0].message).toBe(
      "A cohort of 7 cannot be split into groups of 2. Use an even cohort, or a group size that divides it. Left alone, the schedule would quietly put all seven in one call.",
    );
  });

  it("gives every blocking message a remedy sentence after the first full stop", () => {
    const broken: SessionDesignIssue[] = [
      ...validateSessionDesign(makeDesign({ cohortSize: 7, trials: 6 }), cleanRoutines(), []),
      ...validateSessionDesign(makeDesign({ trials: 9 }), cleanRoutines(), []),
      ...validateSessionDesign(
        makeDesign({ cohortSize: 1, trials: 1, pattern: { type: "all" } }),
        cleanRoutines(),
        [],
      ),
      ...validateSessionDesign(makeDesign({ seats: [{ name: "only" }] }), cleanRoutines(), []),
      ...validateSessionDesign(
        makeDesign(),
        [
          makeRoutine({
            name: "Chat",
            matching: { strategy: "fifo", slots: [{ name: "a" }, { name: "b" }] },
          }),
        ],
        [],
      ),
      ...validateSessionDesign(
        makeDesign({
          cohortSize: 4,
          trials: 2,
          pattern: { type: "sequence", steps: [[[0, 1], [2, 3]], [[0, 1], [1, 2]]] },
        }),
        cleanRoutines(),
        [],
      ),
      ...validateSessionDesign(
        makeDesign({ interTrialRoutine: "Rating" }),
        [
          ...cleanRoutines(),
          makeRoutine({
            name: "Rating",
            type: "routine-card",
            interactionPattern: { type: "round-robin", groupSize: 2 },
          }),
        ],
        [],
      ),
      ...validateSessionDesign(
        makeDesign({
          cohortSize: 2,
          trials: 1,
          strategy: "property",
          seats: [
            { name: "seat-1", filters: [{ property: "role", operator: "eq", value: "A" }] },
            { name: "seat-2" },
          ],
        }),
        cleanRoutines(),
        [],
      ),
      ...validateSessionDesign(
        makeDesign({ partnerUnavailableText: "   " }),
        cleanRoutines(),
        [],
      ),
    ];
    expect(broken.length).toBeGreaterThan(7);
    // Every error site the module has, so a later copy edit cannot collapse one
    // of them to a single sentence unnoticed.
    expect(new Set(broken.map((issue) => issue.field))).toEqual(
      new Set([
        "cohortSize",
        "trials",
        "seats",
        "trialRoutine",
        "pattern.steps.1",
        "interTrialRoutine",
        "seats.1",
        "partnerUnavailableText",
      ]),
    );
    for (const issue of broken) {
      const remedy = issue.message.split(". ").slice(1).join(". ");
      expect(remedy.length).toBeGreaterThan(0);
      expect(issue.message.endsWith(".")).toBe(true);
    }
  });

  it("pluralises seat lists, repeat counts and the trial remedy", () => {
    const twoMissing = validateSessionDesign(
      makeDesign({
        cohortSize: 4,
        trials: 2,
        pattern: { type: "sequence", steps: [[[0, 1], [2, 3]], [[0, 1], [0, 1]]] },
      }),
      cleanRoutines(),
      [],
    );
    expect(twoMissing[0].message).toContain("seats 3, 4 unassigned");
    expect(twoMissing[0].message).toContain("seats 1, 2 assigned twice");

    const thrice = validateSessionDesign(
      makeDesign({
        cohortSize: 4,
        trials: 2,
        pattern: { type: "sequence", steps: [[[0, 1], [2, 3]], [[0, 0, 0], [1, 2]]] },
      }),
      cleanRoutines(),
      [],
    );
    expect(thrice[0].message).toContain("seat 4 unassigned");
    expect(thrice[0].message).toContain("seat 1 assigned 3 times");

    const oneRotation = validateSessionDesign(
      makeDesign({ cohortSize: 2, trials: 2 }),
      cleanRoutines(),
      [],
    );
    expect(oneRotation).toHaveLength(1);
    expect(oneRotation[0].message).toContain("the 1 unique rotation a cohort of 2 has");
    expect(oneRotation[0].message).toContain("Reduce the schedule to 1 trial,");
  });

  it("reports the over-long schedule rather than throwing on an implausible trial count", () => {
    const issues = validateSessionDesign(makeDesign({ trials: 1e10 }), cleanRoutines(), []);
    expect(issues.map((issue) => issue.field)).toEqual(["trials"]);
  });

  it("blocks a seat list that disagrees with the declared cohort size", () => {
    const design = makeDesign({
      cohortSize: CanonicalCohort,
      seats: Array.from({ length: 4 }, (_, i) => ({ name: `seat-${i + 1}` })),
    });
    const issues = validateSessionDesign(design, cleanRoutines(), []);
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("cohortSize");
    expect(issues[0].message).toContain("declares a cohort of 8 but lists 4 seats");
  });

  it("blocks more trials than a round-robin has unique rotations", () => {
    const issues = validateSessionDesign(makeDesign({ trials: 9 }), cleanRoutines(), []);
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("trials");
    expect(issues[0].message).toContain("7 unique rotations");
  });

  // `computeRoundRobinRotations` only pairs properly for dyads; above that it
  // slices the rotated circle into consecutive chunks, which is not a
  // resolvable design. `cohortSize - 1` was being treated as the bound for
  // every group size, so the nine-person triad study validated clean while a
  // third of its pairs never met.
  it("blocks a triad round-robin whose schedule is not a round-robin at all", () => {
    const design = makeDesign({
      cohortSize: 9,
      trials: 8,
      pattern: { type: "round-robin", groupSize: 3 },
    });
    const issues = validateSessionDesign(design, cleanRoutines(), []);
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("error");
    expect(issues[0].field).toBe("pattern");
    // The real numbers, not a rule: 24 of 36 met, 12 never, 48 repeats.
    expect(issues[0].message).toBe(
      "A round-robin in groups of 3 does not cover a cohort of 9. Over 8 trials only 24 of the 36 possible pairs meet, leaving 12 pairs who never do, and 48 repeat pairings; use groups of 2, or write the trials out as an explicit schedule, because this block would otherwise run to completion and look clean while those pairs never happen.",
    );
  });

  it("blocks a groups-of-three cohort of twelve on the same coverage grounds", () => {
    const issues = validateSessionDesign(
      makeDesign({ cohortSize: 12, trials: 11, pattern: { type: "round-robin", groupSize: 3 } }),
      cleanRoutines(),
      [],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("only 33 of the 66 possible pairs meet");
  });

  // The measurement is the authority, not the group size: one group holding the
  // whole cohort for a single trial genuinely does introduce every pair once.
  it("allows a larger group whose coverage is actually complete", () => {
    const issues = validateSessionDesign(
      makeDesign({ cohortSize: 4, trials: 1, pattern: { type: "round-robin", groupSize: 4 } }),
      cleanRoutines(),
      [],
    );
    expect(issues).toEqual([]);
  });

  // The coverage rule has to BUILD the schedule to measure it, and that is
  // quadratic in the cohort size, so a mistyped cohort must be refused by
  // arithmetic before anything is materialised. Without the clamp this test
  // does not fail — it never returns.
  it("refuses an implausible cohort instead of building its schedule", () => {
    const issues = validateSessionDesign(
      makeDesign({ cohortSize: 2_000_000, seats: [], trials: 1 }),
      cleanRoutines(),
      [],
    );
    expect(issues.map((issue) => issue.field)).toContain("cohortSize");
    expect(issues.some((issue) => issue.message.includes("200 seats"))).toBe(true);
  });

  // Unticking "full round-robin" is a supported choice, so this must never block.
  it("warns without blocking when a dyad schedule is deliberately short", () => {
    const issues = validateSessionDesign(makeDesign({ trials: 3 }), cleanRoutines(), []);
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("warning");
    expect(issues[0].field).toBe("trials");
    expect(issues[0].message).toBe(
      "This schedule runs 3 trials of the 7 unique rotations available, so 12 of the 28 pairs in the cohort meet and 16 pairs never do. Extend it to 7 trials if every pair must meet.",
    );
  });

  it("blocks a trial routine that still carries its own matching", () => {
    const routines = [
      makeRoutine({
        name: "Chat",
        matching: { strategy: "fifo", slots: [{ name: "a" }, { name: "b" }] },
      }),
    ];
    const issues = validateSessionDesign(makeDesign(), routines, []);
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("trialRoutine");
    expect(issues[0].message).toContain("carries its own matching");
  });

  it("blocks a second rotating routine inside the block", () => {
    const routines = [
      ...cleanRoutines(),
      makeRoutine({
        name: "Rating",
        type: "routine-card",
        interactionPattern: { type: "round-robin", groupSize: 2 },
      }),
    ];
    const issues = validateSessionDesign(makeDesign({ interTrialRoutine: "Rating" }), routines, []);
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("interTrialRoutine");
    expect(issues[0].message).toContain("advance the rotation index twice");
  });

  // computeRotationIndex counts EVERY round-robin routine between the match
  // progress and the current one, not only the one the design declares.
  it("blocks any other rotating routine authored into the block's progress band", () => {
    const routines = [
      ...cleanRoutines(),
      makeRoutine({
        name: "Warmup",
        type: "routine-card",
        interactionPattern: { type: "round-robin", groupSize: 2 },
      }),
    ];
    const issues = validateSessionDesign(makeDesign(), routines, [], [
      { progress: 5, routine: "Warmup" },
      { progress: 6, routine: "Warmup" },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("pattern");
    expect(issues[0].message).toContain('Routine "Warmup" also rotates');
  });

  it("ignores a rotating routine that sits outside the block's progress band", () => {
    const routines = [
      ...cleanRoutines(),
      makeRoutine({
        name: "Warmup",
        type: "routine-card",
        interactionPattern: { type: "round-robin", groupSize: 2 },
      }),
    ];
    const issues = validateSessionDesign(makeDesign(), routines, [], [
      { progress: 99, routine: "Warmup" },
    ]);
    expect(issues).toEqual([]);
  });

  it("blocks a sequence row that does not assign every seat exactly once", () => {
    const design = makeDesign({
      cohortSize: 4,
      trials: 2,
      pattern: { type: "sequence", steps: [[[0, 1], [2, 3]], [[0, 1], [1, 2]]] },
    });
    const issues = validateSessionDesign(design, cleanRoutines(), []);
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("pattern.steps.1");
    expect(issues[0].message).toContain("Trial 2");
    expect(issues[0].message).toContain("seat 4 unassigned");
    expect(issues[0].message).toContain("seat 2 assigned twice");
  });

  it("blocks a cohort of fewer than two seats", () => {
    const design = makeDesign({ cohortSize: 1, trials: 1, pattern: { type: "all" } });
    const issues = validateSessionDesign(design, cleanRoutines(), []);
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("seats");
    expect(issues[0].message).toContain("at least 2 seats");
  });

  it("blocks a property-matched seat with no filters", () => {
    const design = makeDesign({
      cohortSize: 2,
      trials: 1,
      strategy: "property",
      seats: [
        { name: "seat-1", filters: [{ property: "role", operator: "eq", value: "A" }] },
        { name: "seat-2" },
      ],
    });
    const issues = validateSessionDesign(design, cleanRoutines(), []);
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("seats.1");
    expect(issues[0].message).toContain("no property filters");
  });

  it("blocks a blank dropout notice", () => {
    const design = makeDesign({ partnerUnavailableText: "   " });
    const issues = validateSessionDesign(design, cleanRoutines(), []);
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("error");
    expect(issues[0].field).toBe("partnerUnavailableText");
    expect(issues[0].message).toContain("dropout notice is blank");
    const remedy = issues[0].message.split(". ").slice(1).join(". ");
    expect(remedy.length).toBeGreaterThan(0);
  });

  it("warns, without blocking, about a condition the experiment does not define", () => {
    const issues = validateSessionDesign(makeDesign({ conditions: ["Ghost"] }), cleanRoutines(), [
      "Basic",
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("warning");
    expect(issues[0].field).toBe("conditions");
    expect(issues[0].message).toContain("Ghost");
  });
});

describe("progressBand", () => {
  // The validator reads only these two integers, and the schedule grid wants
  // them without materialising a row per trial per condition.
  it("agrees with the compiled band for both strides and for an empty schedule", () => {
    const designs = [
      makeDesign(),
      makeDesign({ cohortSize: 4, trials: 3, interTrialRoutine: "Rating" }),
      makeDesign({ trials: 0 }),
      makeDesign({
        cohortSize: 4,
        trials: 99,
        pattern: { type: "sequence", steps: [[[0, 1], [2, 3]], [[0, 2], [1, 3]]] },
      }),
    ];
    for (const design of designs) {
      const { fromProgress, toProgress } = compileSessionDesign(design).band;
      expect(progressBand(design)).toEqual({ fromProgress, toProgress });
    }
  });
});

describe("defaultSessionDesign", () => {
  it("pre-fills the canonical 8-seat round-robin from an empty Builder", () => {
    const design = defaultSessionDesign([makeRoutine({ name: "Chat" })], [], 0);
    expect(design.version).toBe(1);
    expect(design.id).not.toBe("");
    expect(design.cohortSize).toBe(8);
    expect(design.seats).toHaveLength(8);
    expect(design.trials).toBe(7);
    expect(design.pattern).toEqual({ type: "round-robin", groupSize: 2 });
    expect(design.startProgress).toBe(1);
    expect(design.trialRoutine).toBe("Chat");
    expect(design.matchRoutineName).toBe("Chat-match");
    expect(design.endMatchRoutineName).toBe("Chat-end-match");
    expect(design.conditions).toEqual(["Basic"]);
    expect(design.timeoutSeconds).toBe(300);
  });

  it("produces a design that validates and compiles cleanly", () => {
    const routines = [makeRoutine({ name: "Chat" })];
    const design = defaultSessionDesign(routines, [], 4);
    expect(validateSessionDesign(design, routines, [])).toEqual([]);
    expect(compileSessionDesign(design).band).toMatchObject({
      fromProgress: 5,
      toProgress: 13,
    });
  });

  it("adopts an existing matching routine's seats rather than inventing new ones", () => {
    const routines = [
      makeRoutine({
        name: "Lobby",
        type: "routine-matching",
        matching: {
          strategy: "property",
          slots: [{ name: "speaker" }, { name: "listener" }],
          timeout: 120,
          timeoutAction: "proceed",
        },
      }),
      makeRoutine({ name: "Chat" }),
    ];
    const design = defaultSessionDesign(routines, ["A"], 0);
    expect(design.cohortSize).toBe(2);
    expect(design.seats).toEqual([{ name: "speaker" }, { name: "listener" }]);
    expect(design.strategy).toBe("property");
    expect(design.timeoutSeconds).toBe(120);
    expect(design.timeoutAction).toBe("proceed");
    expect(design.trials).toBe(1);
    expect(design.conditions).toEqual(["A"]);
  });

  // crypto.randomUUID is undefined outside a secure context — which is exactly
  // the plain-http LAN host this project serves device pairing from — so the
  // fallback has to carry real entropy, not just a millisecond timestamp.
  it("gives every block a distinct id even without crypto.randomUUID", () => {
    vi.stubGlobal("crypto", {});
    try {
      const ids = new Set(
        Array.from({ length: 50 }, () => defaultSessionDesign(cleanRoutines(), [], 0).id),
      );
      expect(ids.size).toBe(50);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("diffCompiled", () => {
  const liveRoutines = (): RoutineConfig[] => {
    const compiled = compileSessionDesign(makeDesign());
    return compiled.routines.map((routine) => ({ ...routine }));
  };

  it("reports nothing when the Builder matches the compiled block", () => {
    expect(diffCompiled(compileSessionDesign(makeDesign()), liveRoutines())).toEqual([]);
  });

  it("reports a seat count the Builder disagrees on", () => {
    const routines = liveRoutines();
    routines[0].matching = {
      strategy: "fifo",
      slots: Array.from({ length: 6 }, (_, i) => ({ name: `seat-${i + 1}` })),
      timeout: 300,
      timeoutAction: "wait",
    };
    const entries = diffCompiled(compileSessionDesign(makeDesign()), routines);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      routineName: "Chat-match",
      field: "matching.slots",
      message: "Chat-match has 6 seats in the Builder; this block is designed for 8.",
    });
  });

  it("reports a routine the Builder does not have at all", () => {
    const routines = liveRoutines().filter((r) => r.name !== "Chat-end-match");
    const entries = diffCompiled(compileSessionDesign(makeDesign()), routines);
    expect(entries).toHaveLength(1);
    expect(entries[0].routineName).toBe("Chat-end-match");
    expect(entries[0].field).toBe("routine");
    expect(entries[0].message).toContain("is not in the Builder");
  });

  it("reports a rotation pattern the Builder disagrees on", () => {
    const routines = liveRoutines();
    routines[1].interactionPattern = { type: "all" };
    const entries = diffCompiled(compileSessionDesign(makeDesign()), routines);
    expect(entries).toHaveLength(1);
    expect(entries[0].field).toBe("interactionPattern");
    expect(entries[0].message).toContain("everyone together");
    expect(entries[0].message).toContain("round-robin in groups of 2");
  });
});
