import { describe, it, expect, vi } from "vitest";
import type { RoutineConfig } from "ame-shared";
import type { CompiledBlock } from "ame-shared/sessionDesign";
import {
  applyDisplay,
  applyErrorMessage,
  canStartApply,
  runApply,
  shouldAdoptRoutines,
  uploadOnly,
} from "$lib/admin/applySequence";
import { upsertByName } from "$lib/admin/sessionDesigns";
import { describeApplyBar } from "$lib/admin/applyBarView";

/**
 * Records the order of the two writes, so a test can prove the content upload
 * never runs before the routines are safely on the experiment.
 */
function recordingIo(
  overrides: { saveRoutines?: () => Promise<void>; uploadContent?: () => Promise<void> } = {},
) {
  const calls: string[] = [];

  return {
    calls,
    saveRoutines: vi.fn(async () => {
      calls.push("saveRoutines");
      await overrides.saveRoutines?.();
    }),
    uploadContent: vi.fn(async () => {
      calls.push("uploadContent");
      await overrides.uploadContent?.();
    }),
  };
}

describe("runApply", () => {
  it("saves routines then uploads content, and reports applied", async () => {
    const io = recordingIo();

    await expect(runApply(io)).resolves.toEqual({ state: "applied", error: null });
    expect(io.calls).toEqual(["saveRoutines", "uploadContent"]);
  });

  it("never uploads content when the routines write fails", async () => {
    const io = recordingIo({
      saveRoutines: async () => {
        throw new Error("Experiment not found");
      },
    });

    await expect(runApply(io)).resolves.toEqual({ state: "idle", error: "Experiment not found" });
    expect(io.uploadContent).not.toHaveBeenCalled();
  });

  it("surfaces a failed content upload as routines-only rather than half-writing silently", async () => {
    const io = recordingIo({
      uploadContent: async () => {
        throw new Error("Content band overlaps an existing block");
      },
    });

    await expect(runApply(io)).resolves.toEqual({
      state: "routines-only",
      error: "Content band overlaps an existing block",
    });
    expect(io.saveRoutines).toHaveBeenCalledTimes(1);
  });
});

describe("uploadOnly", () => {
  it("retries the content upload alone and reaches applied", async () => {
    const io = recordingIo();

    await expect(uploadOnly(io)).resolves.toEqual({ state: "applied", error: null });
    expect(io.calls).toEqual(["uploadContent"]);
  });

  it("stays in routines-only when the retry fails again", async () => {
    const io = recordingIo({
      uploadContent: async () => {
        throw new Error("Network request failed");
      },
    });

    await expect(uploadOnly(io)).resolves.toEqual({
      state: "routines-only",
      error: "Network request failed",
    });
  });
});

describe("shouldAdoptRoutines", () => {
  it("refuses adoption when the routines write never landed", () => {
    expect(shouldAdoptRoutines({ state: "idle", error: "Experiment not found" })).toBe(false);
  });

  it("allows adoption once the server holds the routines", () => {
    expect(shouldAdoptRoutines({ state: "applied", error: null })).toBe(true);
    expect(shouldAdoptRoutines({ state: "routines-only", error: "upload failed" })).toBe(true);
  });
});

/**
 * The ordering handleApply depends on, composed from the same pure functions it
 * calls. Adopting the block's routines BEFORE the first write resolves is what
 * makes the compile plan lie: the verb is read back off the Builder, so a local
 * routine the server never received would print as `~ rewrite`.
 */
describe("the Builder adopts routines only after the server has them", () => {
  const blockRoutines: RoutineConfig[] = [
    { name: "Chat-match", type: "routine-matching", layout: { rows: [] }, elements: [], matching: null },
    { name: "Chat", type: "routine-video-chat", layout: { rows: [] }, elements: [], matching: null },
    {
      name: "Chat-end-match",
      type: "routine-end-matching",
      layout: { rows: [] },
      elements: [],
      matching: null,
    },
  ];

  const compiled = {
    routines: blockRoutines,
    contentRows: [],
    band: { fromProgress: 1, toProgress: 9, conditions: ["Basic"], blockId: "blk1" },
    participantsPerSession: 8,
  } as unknown as CompiledBlock;

  /** Runs both writes and adopts the routines exactly as handleApply does. */
  async function applyInto(builder: RoutineConfig[], io: Parameters<typeof runApply>[0]) {
    const outcome = await runApply(io);
    const next = shouldAdoptRoutines(outcome) ? upsertByName(builder, blockRoutines) : builder;
    return { outcome, names: next.map((r) => r.name) };
  }

  it("leaves the Builder untouched when the first write rejects, so the plan still says '+'", async () => {
    const builder: RoutineConfig[] = [
      { name: "Consent", type: "routine-consent", layout: { rows: [] }, elements: [] },
    ];

    const { outcome, names } = await applyInto(builder, {
      saveRoutines: async () => {
        throw new Error("Experiment not found");
      },
      uploadContent: async () => {},
    });

    expect(outcome.state).toBe("idle");
    expect(names).toEqual(["Consent"]);
    expect(describeApplyBar(compiled, [], "idle", names).items.map((item) => item.verb)).toEqual([
      "+",
      "+",
      "+",
    ]);
  });

  it("adopts them once the first write lands, even if the content upload then fails", async () => {
    const builder: RoutineConfig[] = [
      { name: "Consent", type: "routine-consent", layout: { rows: [] }, elements: [] },
    ];

    const { outcome, names } = await applyInto(builder, {
      saveRoutines: async () => {},
      uploadContent: async () => {
        throw new Error("Content band overlaps an existing block");
      },
    });

    expect(outcome.state).toBe("routines-only");
    expect(names).toEqual(["Consent", "Chat-match", "Chat", "Chat-end-match"]);
    expect(describeApplyBar(compiled, [], "idle", names).items.map((item) => item.verb)).toEqual([
      "~",
      "~",
      "~",
    ]);
  });
});

describe("applyErrorMessage", () => {
  it("uses an Error's own message", () => {
    expect(applyErrorMessage(new Error("Experiment not found"))).toBe("Experiment not found");
  });

  it("falls back for a thrown non-Error or an empty message", () => {
    const fallback = "Unexpected error while saving the session block";
    expect(applyErrorMessage("boom")).toBe(fallback);
    expect(applyErrorMessage(new Error(""))).toBe(fallback);
  });
});

describe("canStartApply", () => {
  const block = {
    routines: [],
    contentRows: [],
    band: { fromProgress: 1, toProgress: 9, conditions: ["Basic"], blockId: "blk1" },
    participantsPerSession: 8,
  } as unknown as CompiledBlock;

  it("refuses when there is nothing compiled to write", () => {
    expect(canStartApply(null, false)).toBe(false);
  });

  it("allows the first press", () => {
    expect(canStartApply(block, false)).toBe(true);
  });

  it("refuses a second press while the first sequence is still running", () => {
    // The C1 repro: an edit mid-write resets the apply STATE to idle, so the
    // state alone cannot be the guard — two PUTs with different replace bands
    // would otherwise be in the air at once.
    expect(canStartApply(block, true)).toBe(false);
  });
});

describe("applyDisplay", () => {
  it("passes a fresh outcome through untouched", () => {
    expect(applyDisplay({ state: "applied", error: null }, false)).toEqual({
      state: "applied",
      error: null,
    });
  });

  it("keeps a fresh half-write on routines-only, so Retry upload is offered", () => {
    expect(applyDisplay({ state: "routines-only", error: "upload failed" }, false)).toEqual({
      state: "routines-only",
      error: "upload failed",
    });
  });

  it("never reports a stale success over an edited design", () => {
    expect(applyDisplay({ state: "applied", error: null }, true)).toEqual({
      state: "idle",
      error: null,
    });
  });

  it("still surfaces the error of a write that failed after an edit", () => {
    // The C2 repro: routines are on the server, content rows are not, and
    // without this the bar reads "ready" with no error at all.
    expect(
      applyDisplay({ state: "routines-only", error: "Content band overlaps" }, true),
    ).toEqual({ state: "idle", error: "Content band overlaps" });
  });

  it("surfaces the error of a failed routines write after an edit", () => {
    expect(applyDisplay({ state: "idle", error: "Experiment not found" }, true)).toEqual({
      state: "idle",
      error: "Experiment not found",
    });
  });
});
