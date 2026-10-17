import { describe, it, expect } from "vitest";
import type { RoutineConfig } from "ame-shared";
import type { DriftEntry } from "ame-shared/sessionDesign";
import { compileSessionDesign, defaultSessionDesign } from "ame-shared/sessionDesign";
import { adoptDisabledReason, adoptPatch } from "$lib/admin/driftAdoption";

/** The Builder the bench starts from: one video-chat routine called "Chat". */
const builderRoutines: RoutineConfig[] = [
  { name: "Chat", type: "routine-video-chat", layout: { rows: [] }, elements: [] },
];

const design = () => defaultSessionDesign(builderRoutines, ["Basic"], 0);

/** The Builder as it stands after the block has been applied once. */
const appliedRoutines = () => compileSessionDesign(design()).routines;

const entry = (field: string, routineName = "Chat"): DriftEntry => ({
  routineName,
  field,
  message: `${routineName} differs on ${field}.`,
});

describe("adoptDisabledReason", () => {
  it("allows adoption when every difference is a seat count", () => {
    expect(adoptDisabledReason([entry("matching.slots", "Chat-match")])).toBeNull();
  });

  it("allows adoption when every difference is an interaction pattern", () => {
    expect(adoptDisabledReason([entry("interactionPattern")])).toBeNull();
  });

  it("refuses adoption for a routine the Builder no longer holds", () => {
    const reason = adoptDisabledReason([entry("routine", "Chat-match")]);

    expect(reason).toContain("Chat-match is not in the Builder");
    expect(reason).toContain("Overwrite from Design");
  });

  it("refuses adoption for a routine whose type disagrees", () => {
    const reason = adoptDisabledReason([entry("type", "Chat-match")]);

    expect(reason).toContain("a different kind of routine");
  });

  it("refuses a mixed set, because a half-resolved adoption still leaves drift", () => {
    expect(
      adoptDisabledReason([entry("matching.slots", "Chat-match"), entry("routine", "Chat")]),
    ).not.toBeNull();
  });
});

describe("adoptPatch", () => {
  it("takes the Builder's seats, keeping cohortSize equal to them", () => {
    const routines = appliedRoutines();
    const match = routines.find((r) => r.type === "routine-matching")!;
    match.matching!.slots = match.matching!.slots.slice(0, 4);

    const patch = adoptPatch(design(), routines);

    expect(patch.seats).toHaveLength(4);
    expect(patch.cohortSize).toBe(4);
  });

  it("takes the Builder's matching strategy and timeout", () => {
    const routines = appliedRoutines();
    const match = routines.find((r) => r.type === "routine-matching")!;
    match.matching = { ...match.matching!, strategy: "manual", timeout: 60, timeoutAction: "proceed" };

    const patch = adoptPatch(design(), routines);

    expect(patch.strategy).toBe("manual");
    expect(patch.timeoutSeconds).toBe(60);
    expect(patch.timeoutAction).toBe("proceed");
  });

  it("takes the Builder's role assignment", () => {
    const routines = appliedRoutines();
    const match = routines.find((r) => r.type === "routine-matching")!;
    match.matching = {
      ...match.matching!,
      assignment: { mode: "counterbalanced", set: "rotation", order: "block-shuffled" },
    };

    const patch = adoptPatch(design(), routines);

    expect(patch.assignment).toEqual({
      mode: "counterbalanced",
      set: "rotation",
      order: "block-shuffled",
    });
  });

  it("clears the design's assignment when the Builder no longer carries one", () => {
    // Adoption takes the Builder's live value. Leaving the design's own
    // assignment in place would put it straight back on the next apply.
    const routines = appliedRoutines();
    const patch = adoptPatch(
      { ...design(), assignment: { mode: "counterbalanced", set: "rotation", order: "sequential" } },
      routines,
    );

    expect(patch.assignment).toBeUndefined();
  });

  it("takes the trial routine's interaction pattern — the drift kind adoption used to ignore", () => {
    const routines = appliedRoutines();
    const trial = routines.find((r) => r.type === "routine-video-chat")!;
    trial.interactionPattern = { type: "round-robin", groupSize: 4 };

    const patch = adoptPatch(design(), routines);

    expect(patch.pattern).toEqual({ type: "round-robin", groupSize: 4 });
  });

  it("copies rather than aliases the Builder's arrays", () => {
    const routines = appliedRoutines();
    const patch = adoptPatch(design(), routines);
    const match = routines.find((r) => r.type === "routine-matching")!;

    expect(patch.seats).not.toBe(match.matching!.slots);
    expect(patch.seats![0]).not.toBe(match.matching!.slots[0]);
  });

  it("patches nothing when the Builder holds neither routine", () => {
    expect(adoptPatch(design(), [])).toEqual({});
  });
});
