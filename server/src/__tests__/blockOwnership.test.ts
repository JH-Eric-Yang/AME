import { describe, it, expect } from "vitest";
import { compileSessionDesign, diffCompiled } from "ame-shared/sessionDesign";
import type { SessionDesign } from "ame-shared/sessionDesign";
import type { RoutineConfig } from "ame-shared";
import {
  ownedRoutineNames,
  findOwningDesign,
  describeOwnership,
  driftHeadline,
} from "ame-shared/blockOwnership";

/** The canonical study from the design doc: eight seats, dyads, seven trials. */
const CanonicalCohortSize = 8;
const CanonicalTrials = 7;

function canonicalDesign(overrides: Partial<SessionDesign> = {}): SessionDesign {
  return {
    version: 1,
    id: "blk-chat",
    label: "Chat",
    cohortSize: CanonicalCohortSize,
    strategy: "fifo",
    timeoutSeconds: 300,
    timeoutAction: "wait",
    seats: Array.from({ length: CanonicalCohortSize }, (_, index) => ({ name: `seat-${index + 1}` })),
    pattern: { type: "round-robin", groupSize: 2 },
    trials: CanonicalTrials,
    trialRoutine: "Chat",
    interTrialRoutine: null,
    conditions: ["Basic"],
    startProgress: 1,
    matchRoutineName: "Chat-match",
    endMatchRoutineName: "Chat-end-match",
    partnerUnavailableText: "Your partner has left the study.",
    trialContent: {},
    ...overrides,
  };
}

describe("ownedRoutineNames", () => {
  it("lists the match, trial and end-match routines in compile order", () => {
    expect(ownedRoutineNames(canonicalDesign())).toEqual([
      "Chat-match",
      "Chat",
      "Chat-end-match",
    ]);
  });

  it("includes the inter-trial routine when the block has one", () => {
    const design = canonicalDesign({ interTrialRoutine: "Rest" });

    expect(ownedRoutineNames(design)).toEqual(["Chat-match", "Chat", "Chat-end-match", "Rest"]);
  });

  it("drops a routine name the design left blank, so no block owns the empty name", () => {
    const design = canonicalDesign({ endMatchRoutineName: "" });

    expect(ownedRoutineNames(design)).toEqual(["Chat-match", "Chat"]);
    expect(findOwningDesign("", [design])).toBeNull();
  });

  // sessionDesigns is a Json column and `validateRoutineRotations` reads it
  // BEFORE `validateSessionDesigns` refuses a malformed one, so an unrecognisable
  // entry has to claim nothing rather than throw inside an async handler.
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "chat"],
    ["a number", 42],
    ["an empty object", {}],
  ])("claims nothing for a design that is %s", (_label, malformed) => {
    expect(ownedRoutineNames(malformed as never)).toEqual([]);
    expect(findOwningDesign("Chat", [malformed as never])).toBeNull();
  });
});

describe("findOwningDesign", () => {
  it("returns the block that owns a routine name", () => {
    const design = canonicalDesign();

    expect(findOwningDesign("Chat-match", [design])?.id).toBe("blk-chat");
  });

  it("returns null for a routine no block owns", () => {
    expect(findOwningDesign("Consent", [canonicalDesign()])).toBeNull();
  });

  it("picks the block that actually owns the routine when several exist", () => {
    const chat = canonicalDesign();
    const debate = canonicalDesign({
      id: "blk-debate",
      label: "Debate",
      trialRoutine: "Debate",
      matchRoutineName: "Debate-match",
      endMatchRoutineName: "Debate-end-match",
    });

    expect(findOwningDesign("Debate-match", [chat, debate])?.id).toBe("blk-debate");
  });
});

describe("describeOwnership", () => {
  it("names the block and counts seats and rotations, as the mockup words it", () => {
    expect(describeOwnership(canonicalDesign())).toBe(
      "owned by block “Chat” — 8 seats, 7 rotations",
    );
  });

  it("singularises a one-rotation block", () => {
    const design = canonicalDesign({
      cohortSize: 2,
      seats: [{ name: "seat-1" }, { name: "seat-2" }],
      trials: 1,
    });

    expect(describeOwnership(design)).toBe("owned by block “Chat” — 2 seats, 1 rotation");
  });
});

describe("driftHeadline", () => {
  it("singularises a lone difference", () => {
    expect(driftHeadline([{ message: "any" }])).toBe("Builder edits detected — 1 difference");
  });

  it("pluralises several differences", () => {
    const entries = [{ message: "a" }, { message: "b" }, { message: "c" }];

    expect(driftHeadline(entries)).toBe("Builder edits detected — 3 differences");
  });
});

describe("drift against the live Builder routines", () => {
  it("reports nothing when the Builder holds exactly what the design compiles to", () => {
    const compiled = compileSessionDesign(canonicalDesign());

    expect(diffCompiled(compiled, compiled.routines)).toEqual([]);
  });

  it("reports a seat count edited in the Builder, headlined for the strip", () => {
    const compiled = compileSessionDesign(canonicalDesign());
    const edited: RoutineConfig[] = structuredClone(compiled.routines);
    const matchRoutine = edited.find((routine) => routine.name === "Chat-match");
    if (!matchRoutine?.matching) {
      throw new Error("compiled block has no Chat-match routine carrying a matching config");
    }
    matchRoutine.matching = {
      ...matchRoutine.matching,
      slots: matchRoutine.matching.slots.slice(0, 6),
    };

    const entries = diffCompiled(compiled, edited);

    expect(entries.map((entry) => entry.message)).toEqual([
      "Chat-match has 6 seats in the Builder; this block is designed for 8.",
    ]);
    expect(driftHeadline(entries)).toBe("Builder edits detected — 1 difference");
  });
});
