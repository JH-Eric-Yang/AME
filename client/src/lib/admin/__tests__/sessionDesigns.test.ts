import { describe, it, expect } from "vitest";
import type { RoutineConfig } from "ame-shared";
import { compileSessionDesign, defaultSessionDesign } from "ame-shared/sessionDesign";
import {
  blockIdsWithRows,
  initialApplyState,
  lastProgressOf,
  replaceDesign,
  uniqueLabel,
  upsertByName,
} from "$lib/admin/sessionDesigns";

function routine(name: string, extra: Partial<RoutineConfig> = {}): RoutineConfig {
  return { name, type: "routine-borderless", layout: { rows: [] }, elements: [], ...extra };
}

describe("lastProgressOf", () => {
  it("returns 0 for an experiment with no content rows", () => {
    expect(lastProgressOf([])).toBe(0);
  });

  it("returns the highest progress regardless of row order", () => {
    expect(lastProgressOf([{ progress: 3 }, { progress: 9 }, { progress: 5 }])).toBe(9);
  });

  it("ignores rows whose progress is missing or not a number", () => {
    expect(lastProgressOf([{ progress: 2 }, { routine: "Chat" }, { progress: "4" }])).toBe(2);
  });
});

describe("replaceDesign", () => {
  const designs = [
    { id: "a", label: "Chat block", trials: 7 },
    { id: "b", label: "Second block", trials: 3 },
  ];

  it("merges the patch into the design with that id", () => {
    expect(replaceDesign(designs, "b", { trials: 5 })).toEqual([
      { id: "a", label: "Chat block", trials: 7 },
      { id: "b", label: "Second block", trials: 5 },
    ]);
  });

  it("leaves the source array untouched", () => {
    replaceDesign(designs, "a", { trials: 1 });
    expect(designs[0].trials).toBe(7);
  });

  it("returns the same array reference when no design has that id", () => {
    expect(replaceDesign(designs, "missing", { trials: 1 })).toBe(designs);
  });
});

describe("upsertByName", () => {
  it("replaces a routine in place instead of appending a duplicate", () => {
    const existing = [routine("Chat-match"), routine("Chat"), routine("Debrief")];
    const rebuilt = routine("Chat-match", { type: "routine-matching" });

    const next = upsertByName(existing, [rebuilt]);

    expect(next.map((r) => r.name)).toEqual(["Chat-match", "Chat", "Debrief"]);
    expect(next[0].type).toBe("routine-matching");
  });

  it("appends routines whose names are not present yet, keeping order", () => {
    const next = upsertByName([routine("Consent")], [routine("Chat-match"), routine("Chat")]);

    expect(next.map((r) => r.name)).toEqual(["Consent", "Chat-match", "Chat"]);
  });

  it("is idempotent, so re-applying a block never duplicates the match routine", () => {
    const block = [routine("Chat-match"), routine("Chat"), routine("Chat-end-match")];

    expect(upsertByName(upsertByName([], block), block).map((r) => r.name)).toEqual([
      "Chat-match",
      "Chat",
      "Chat-end-match",
    ]);
  });

  it("leaves the source array untouched, so a failed write cannot mutate the Builder", () => {
    const existing = [routine("Consent")];

    upsertByName(existing, [routine("Chat-match")]);

    expect(existing.map((r) => r.name)).toEqual(["Consent"]);
  });
});

describe("uniqueLabel", () => {
  it("keeps the base label when it is free", () => {
    expect(uniqueLabel(["Second block"], "Chat block")).toBe("Chat block");
  });

  it("appends the first free number when the base is taken", () => {
    expect(uniqueLabel(["Chat block"], "Chat block")).toBe("Chat block 2");
    expect(uniqueLabel(["Chat block", "Chat block 2"], "Chat block")).toBe("Chat block 3");
  });
});

describe("blockIdsWithRows", () => {
  it("collects the block id off every generated row", () => {
    const ids = blockIdsWithRows([
      { description: "block:block-aaaa1111:0" },
      { description: "block:block-aaaa1111:1" },
      { description: "block:block-bbbb2222:0" },
    ]);

    expect([...ids].sort()).toEqual(["block-aaaa1111", "block-bbbb2222"]);
  });

  it("ignores hand-authored rows and rows with no description", () => {
    const ids = blockIdsWithRows([
      { description: "Consent page" },
      { progress: 3 },
      { description: null },
    ]);

    expect(ids.size).toBe(0);
  });
});

describe("initialApplyState", () => {
  /** The bench block: 8 seats, dyads, over the Builder's one video-chat routine. */
  const builder: RoutineConfig[] = [
    { name: "Chat", type: "routine-video-chat", layout: { rows: [] }, elements: [] },
  ];
  const block = () => defaultSessionDesign(builder, ["Basic"], 0);

  it("opens idle for a block that was never applied", () => {
    expect(initialApplyState(block(), builder, new Set())).toBe("idle");
  });

  it("opens idle when the block's own rows are on the server", () => {
    const design = block();
    const applied = compileSessionDesign(design).routines;

    expect(initialApplyState(design, applied, new Set([design.id]))).toBe("idle");
  });

  it("opens routines-only when the routines are saved but the block owns no rows", () => {
    // C6: the content upload failed and the researcher switched tabs. Re-opening
    // must offer Retry upload, not a clean "ready" bar over missing trials.
    const design = block();
    const applied = compileSessionDesign(design).routines;

    expect(initialApplyState(design, applied, new Set(["block-someone-else"]))).toBe(
      "routines-only",
    );
  });

  it("opens idle when the saved routines are a different block's, despite the shared names", () => {
    const design = block();
    const applied = compileSessionDesign(design).routines;
    const match = applied.find((r) => r.type === "routine-matching")!;
    match.matching!.slots = match.matching!.slots.slice(0, 4);

    expect(initialApplyState(design, applied, new Set())).toBe("idle");
  });
});
