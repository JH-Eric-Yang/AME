import { describe, it, expect } from "vitest";
import type { RoutineConfig } from "ame-shared";
import type { SequenceRow } from "ame-shared/progressSequence";
import {
  insertStep, insertTrials, deleteStep, moveStep, duplicateStep, changeRoutine, dependantsOf, renumber, remapRoutineRefs, newRow,
} from "../progressSteps";

const row = (p: Partial<SequenceRow> & { progress: number; routine: string }): SequenceRow => ({
  trialNumber: 1, condition: "Basic", content: {}, description: null, ...p,
});

// 0 intro · 1 chat · 2 recap (refs p0 and p1) · plus one Other-condition row that must never move.
const rows: SequenceRow[] = [
  row({ progress: 0, routine: "intro" }),
  row({ progress: 1, routine: "chat" }),
  row({ progress: 2, routine: "recap", content: { replay: { src: "ref:self/p1/rec" }, text: { content: "Hi {{ref:self/p0/name}}" } } }),
  row({ progress: 0, routine: "intro", condition: "Other", content: { text: { content: "{{ref:self/p0/name}}" } } }),
];
const basic = (r: SequenceRow[]) => r.filter((x) => x.condition === "Basic").map((x) => [x.progress, x.routine]);
const other = (r: SequenceRow[]) => r.filter((x) => x.condition === "Other");

describe("insertStep", () => {
  it("inserts before the step at `at`, renumbers, and rewrites refs past the insertion", () => {
    const { rows: out, positionMap, rewritten } = insertStep(rows, "Basic", 1, "survey");
    expect(basic(out)).toEqual([[0, "intro"], [1, "survey"], [2, "chat"], [3, "recap"]]);
    expect([...positionMap]).toEqual([[0, 0], [1, 2], [2, 3]]);
    expect(out[3].content).toEqual({ replay: { src: "ref:self/p2/rec" }, text: { content: "Hi {{ref:self/p0/name}}" } });
    expect(rewritten).toBe(1);
    expect(other(out)).toEqual(other(rows));
  });

  it("appends at n and creates an empty row", () => {
    const { rows: out } = insertStep(rows, "Basic", 3, "bye");
    expect(basic(out)[3]).toEqual([3, "bye"]);
    expect(out.find((r) => r.routine === "bye")).toEqual(newRow("Basic", 3, "bye"));
  });

  it("does not mutate its input", () => {
    insertStep(rows, "Basic", 0, "x");
    expect(rows[2].content).toEqual({ replay: { src: "ref:self/p1/rec" }, text: { content: "Hi {{ref:self/p0/name}}" } });
  });
});

describe("deleteStep", () => {
  it("refuses to delete a step something references, listing the dependants", () => {
    expect(deleteStep(rows, "Basic", 1)).toEqual({
      refused: [{ position: 2, element: "replay", ref: "ref:self/p1/rec" }],
    });
  });

  it("deletes an unreferenced step, closes the gap and rewrites refs", () => {
    const withGap = [...rows, row({ progress: 3, routine: "spare" })];
    const result = deleteStep(withGap, "Basic", 2);
    expect("refused" in result).toBe(false);
    if ("refused" in result) return;
    // Deleting p2 (recap) is allowed — nothing references it — and p3 becomes p2.
    expect(basic(result.rows)).toEqual([[0, "intro"], [1, "chat"], [2, "spare"]]);
    expect([...result.positionMap]).toEqual([[0, 0], [1, 1], [3, 2]]);
  });

  it("removes every row of the step, extra trials included", () => {
    const dup = [...rows, row({ progress: 0, routine: "intro", trialNumber: 2 })];
    const result = deleteStep(dup.filter((r) => r.progress !== 2 || r.condition !== "Basic"), "Basic", 0);
    if ("refused" in result) throw new Error("unexpected refusal");
    expect(basic(result.rows)).toEqual([[0, "chat"]]);
  });
});

describe("moveStep", () => {
  it("moves a step and rewrites every ref that crosses it", () => {
    const { rows: out, positionMap, rewritten } = moveStep(rows, "Basic", 2, 0);
    expect(basic(out)).toEqual([[0, "recap"], [1, "intro"], [2, "chat"]]);
    expect([...positionMap]).toEqual([[0, 1], [1, 2], [2, 0]]);
    expect(out.find((r) => r.routine === "recap")!.content).toEqual({
      replay: { src: "ref:self/p2/rec" }, text: { content: "Hi {{ref:self/p1/name}}" },
    });
    expect(rewritten).toBe(2);
  });

  it("is a no-op when from equals to", () => {
    const { rows: out, rewritten } = moveStep(rows, "Basic", 1, 1);
    expect(basic(out)).toEqual(basic(rows));
    expect(rewritten).toBe(0);
  });
});

describe("duplicateStep", () => {
  it("inserts a copy right after the original, without a block description", () => {
    const src = rows.map((r) => (r.progress === 1 && r.condition === "Basic" ? { ...r, description: "block:x:1" } : r));
    const { rows: out } = duplicateStep(src, "Basic", 1);
    expect(basic(out)).toEqual([[0, "intro"], [1, "chat"], [2, "chat"], [3, "recap"]]);
    expect(out.find((r) => r.progress === 2 && r.condition === "Basic")!.description).toBeNull();
    expect(out.find((r) => r.routine === "recap")!.content.replay).toEqual({ src: "ref:self/p1/rec" });
  });
});

describe("changeRoutine", () => {
  const survey: RoutineConfig = { name: "survey", type: "routine-card", layout: { rows: [] }, elements: [{ name: "text", type: "text", params: {} }] };

  it("swaps the routine and drops overrides for elements it lacks", () => {
    const out = changeRoutine(rows, "Basic", 2, survey);
    const changed = out.find((r) => r.progress === 2 && r.condition === "Basic")!;
    expect(changed.routine).toBe("survey");
    expect(changed.content).toEqual({ text: { content: "Hi {{ref:self/p0/name}}" } });
  });
});

describe("dependantsOf", () => {
  // A routine default resolves through the same position map as a content
  // override, so a step it points at cannot be deleted either.
  const defaults: RoutineConfig[] = [{
    name: "recap", type: "routine-card", layout: { rows: [] },
    elements: [{ name: "v", type: "video", params: { src: "ref:self/p2/clip" } }],
  }];

  it("lists whole-value and template refs to a position, per element", () => {
    expect(dependantsOf(rows, "Basic", 0)).toEqual([{ position: 2, element: "text", ref: "ref:self/p0/name" }]);
    expect(dependantsOf(rows, "Basic", 2)).toEqual([]);
  });

  it("reports a routine default as a dependant at position -1 when routines are passed", () => {
    expect(dependantsOf(rows, "Basic", 2, defaults)).toEqual([
      { position: -1, element: "recap/v", ref: "ref:self/p2/clip" },
    ]);
    expect(dependantsOf(rows, "Basic", 2, [])).toEqual([]);
  });

  it("makes deleteStep refuse a step a routine default points at", () => {
    expect(deleteStep(rows, "Basic", 2, defaults)).toEqual({
      refused: [{ position: -1, element: "recap/v", ref: "ref:self/p2/clip" }],
    });
    expect("refused" in deleteStep(rows, "Basic", 2)).toBe(false);
  });
});

describe("renumber", () => {
  it("closes gaps in a legacy sequence and rewrites refs accordingly", () => {
    const gappy = [row({ progress: 2, routine: "a" }), row({ progress: 5, routine: "b", content: { t: { content: "{{ref:self/p2/x}}" } } })];
    const { rows: out, rewritten } = renumber(gappy, "Basic");
    expect(basic(out)).toEqual([[0, "a"], [1, "b"]]);
    expect(out[1].content).toEqual({ t: { content: "{{ref:self/p0/x}}" } });
    expect(rewritten).toBe(1);
  });
});

describe("remapRoutineRefs", () => {
  it("rewrites position refs inside routine element params and counts them", () => {
    const routines: RoutineConfig[] = [{
      name: "recap", type: "routine-card", layout: { rows: [] },
      elements: [{ name: "v", type: "video", params: { src: "ref:self/p1/rec" } }, { name: "t", type: "text", params: { content: "{{ref:self/t2/x}}" } }],
    }];
    const { routines: out, rewritten, affected } = remapRoutineRefs(routines, new Map([[1, 4]]));
    expect(out[0].elements[0].params).toEqual({ src: "ref:self/p4/rec" });
    expect(out[0].elements[1].params).toEqual({ content: "{{ref:self/t2/x}}" });
    expect(rewritten).toBe(1);
    expect(affected).toEqual(["recap"]);
    expect(routines[0].elements[0].params).toEqual({ src: "ref:self/p1/rec" });
  });

  it("names only the routines that actually changed", () => {
    const routines: RoutineConfig[] = [
      { name: "untouched", type: "routine-card", layout: { rows: [] }, elements: [{ name: "t", type: "text", params: { content: "plain" } }] },
      { name: "recap", type: "routine-card", layout: { rows: [] }, elements: [{ name: "v", type: "video", params: { src: "ref:self/p1/rec" } }] },
    ];
    expect(remapRoutineRefs(routines, new Map([[1, 4]])).affected).toEqual(["recap"]);
    expect(remapRoutineRefs(routines, new Map([[1, 1]])).affected).toEqual([]);
  });
});

describe("references in showWhen", () => {
  const gated: RoutineConfig = {
    name: "gate",
    type: "routine-card",
    layout: { rows: [] },
    elements: [
      { name: "hint", type: "text", params: {}, showWhen: [{ property: "ref:self/p2/answer", operator: "eq", value: "yes" }] },
    ],
  };

  it("dependantsOf counts a condition that references the step", () => {
    expect(dependantsOf([], "Basic", 2, [gated])).toEqual([{ position: -1, element: "gate/hint", ref: "ref:self/p2/answer" }]);
  });

  it("remapRoutineRefs rewrites a condition's position", () => {
    const out = remapRoutineRefs([gated], new Map([[2, 3]]));
    expect(out.routines[0].elements[0].showWhen).toEqual([{ property: "ref:self/p3/answer", operator: "eq", value: "yes" }]);
    expect(out.rewritten).toBe(1);
    expect(out.affected).toEqual(["gate"]);
  });

  it("leaves an element without conditions without a showWhen key", () => {
    const plain: RoutineConfig = { ...gated, elements: [{ name: "t", type: "text", params: {} }] };
    expect("showWhen" in remapRoutineRefs([plain], new Map([[2, 3]])).routines[0].elements[0]).toBe(false);
  });

  it("rewriting property keeps value and operator unchanged even if value looks like a reference", () => {
    const withValueRef: RoutineConfig = {
      name: "gate",
      type: "routine-card",
      layout: { rows: [] },
      elements: [
        { name: "hint", type: "text", params: {}, showWhen: [{ property: "ref:self/p2/answer", operator: "eq", value: "ref:self/p2/other" }] },
      ],
    };
    const out = remapRoutineRefs([withValueRef], new Map([[2, 3]]));
    expect(out.routines[0].elements[0].showWhen).toEqual([{ property: "ref:self/p3/answer", operator: "eq", value: "ref:self/p2/other" }]);
    expect(out.rewritten).toBe(1);
  });

  it("dependantsOf ignores reference-like strings in value field", () => {
    const valueOnly: RoutineConfig = {
      name: "gate",
      type: "routine-card",
      layout: { rows: [] },
      elements: [
        { name: "hint", type: "text", params: {}, showWhen: [{ property: "answer", operator: "eq", value: "ref:self/p2/other" }] },
      ],
    };
    expect(dependantsOf([], "Basic", 2, [valueOnly])).toEqual([]);
  });

  it("a template embedded in a property is neither a dependant nor rewritten", () => {
    const templated: RoutineConfig = {
      name: "gate",
      type: "routine-card",
      layout: { rows: [] },
      elements: [
        { name: "hint", type: "text", params: {}, showWhen: [{ property: "{{ref:self/p2/x}}", operator: "eq", value: "yes" }] },
      ],
    };
    expect(dependantsOf([], "Basic", 2, [templated])).toEqual([]);

    const out = remapRoutineRefs([templated], new Map([[2, 3]]));
    expect(out.routines[0].elements[0].showWhen).toEqual([{ property: "{{ref:self/p2/x}}", operator: "eq", value: "yes" }]);
    expect(out.rewritten).toBe(0);
    expect(out.affected).toEqual([]);
  });
});

describe("insertTrials", () => {
  const target = { routine: "stimulus", element: "stim", param: "src" };

  it("inserts one step per value, each holding only that one override", () => {
    const { rows: out } = insertTrials(rows, "Basic", 1, target, ["asset:a", "asset:b"]);
    expect(basic(out)).toEqual([[0, "intro"], [1, "stimulus"], [2, "stimulus"], [3, "chat"], [4, "recap"]]);
    expect(out.filter((r) => r.routine === "stimulus").map((r) => r.content)).toEqual([
      { stim: { src: "asset:a" } },
      { stim: { src: "asset:b" } },
    ]);
  });

  it("gives each new step its own trial number above the condition's highest", () => {
    const withTrial = [...rows.slice(0, 2), { ...rows[2], trialNumber: 4 }, rows[3]];
    const result = insertTrials(withTrial, "Basic", 3, target, ["a", "b", "c"]);
    expect(result.rows.filter((r) => r.routine === "stimulus").map((r) => r.trialNumber)).toEqual([5, 6, 7]);
    expect(result.trials).toEqual({ from: 5, to: 7 });
  });

  it("rewrites refs past the insertion and leaves other conditions alone", () => {
    const { rows: out, rewritten } = insertTrials(rows, "Basic", 1, target, ["a"]);
    expect(out.find((r) => r.routine === "recap")!.content).toEqual({
      replay: { src: "ref:self/p2/rec" }, text: { content: "Hi {{ref:self/p0/name}}" },
    });
    expect(rewritten).toBe(1);
    expect(other(out)).toEqual(other(rows));
  });

  it("changes nothing for an empty list", () => {
    expect(basic(insertTrials(rows, "Basic", 0, target, []).rows)).toEqual(basic(rows));
  });
});
