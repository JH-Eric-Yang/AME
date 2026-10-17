import { describe, it, expect } from "vitest";
import type { ElementConfig, RoutineConfig, RoutineType } from "ame-shared";
import type { SequenceRow } from "ame-shared/progressSequence";
import { whoOptions, whereOptions, elementOptions, buildRef, type RefOptionsInput } from "../refOptions";

const routine = (name: string, type: RoutineType, extra: Partial<RoutineConfig> = {}): RoutineConfig => ({
  name, type, layout: { rows: [] }, elements: [], ...extra,
});
const el = (name: string, type: ElementConfig["type"], params: object = {}): ElementConfig => ({ name, type, params }) as ElementConfig;
const row = (p: Partial<SequenceRow> & { progress: number; routine: string }): SequenceRow => ({
  trialNumber: 1, condition: "Basic", content: {}, description: null, ...p,
});

const routines = [
  routine("intro", "routine-card", { elements: [el("name", "input-textfield"), el("clip", "recorder"), el("files", "input-file-picker"),
    el("q", "survey", { surveyJson: { pages: [{ elements: [{ name: "age" }, { name: "mood" }] }] } })] }),
  routine("match", "routine-matching", { matching: { strategy: "fifo", slots: [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }] } }),
  routine("chat", "routine-video-chat", { interactionPattern: { type: "round-robin", groupSize: 2 }, elements: [el("rec", "recorder")] }),
  routine("survey", "routine-card", { elements: [el("q", "survey")] }),
  routine("end-match", "routine-end-matching"),
  routine("debrief", "routine-card"),
];
const rows = [
  row({ progress: 0, routine: "intro" }), row({ progress: 1, routine: "match" }),
  row({ progress: 2, routine: "chat", trialNumber: 1 }), row({ progress: 3, routine: "chat", trialNumber: 2 }),
  row({ progress: 4, routine: "chat", trialNumber: 3 }), row({ progress: 5, routine: "survey", trialNumber: 3 }),
  row({ progress: 6, routine: "end-match" }), row({ progress: 7, routine: "debrief" }),
];
const input = (from: number | null, kind: RefOptionsInput["kind"] = null): RefOptionsInput => ({
  rows, condition: "Basic", routines, ranges: [{ fromTrial: 2, toTrial: 3, method: "shuffle" }], from, kind,
});

describe("whoOptions", () => {
  it("offers self only outside a band, and bounded partner/seat inside one", () => {
    expect(whoOptions(input(0))).toEqual([{ kind: "self", label: "Me", max: null }]);
    expect(whoOptions(input(3))).toEqual([
      { kind: "self", label: "Me", max: null },
      { kind: "partner", label: "My partner", max: 1 },
      { kind: "seat", label: "A seat", max: 4 },
    ]);
  });

  it("is unrestricted from the Builder", () => {
    expect(whoOptions(input(null)).map((o) => [o.kind, o.max])).toEqual([["self", null], ["partner", null], ["seat", null]]);
  });
});

describe("whereOptions", () => {
  it("lists every step with safety reasons, greying rather than hiding the later ones", () => {
    const { byStep } = whereOptions(input(4));
    expect(byStep.map((o) => [o.label, o.disabledReason])).toEqual([
      ["p0 · t1 · intro", null],
      ["p1 · t1 · match", null],
      ["p2 · t1 · chat", null],
      ["p3 · t2 · chat", "p3 and p4 are both in a shuffled range (p3–p5) and may swap; use t<K>"],
      ["p4 · t3 · chat", "p4 is not before p4"],
      ["p5 · t3 · survey", "p5 is not before p4"],
      ["p6 · t1 · end-match", "p6 is not before p4"],
      ["p7 · t1 · debrief", "p7 is not before p4"],
    ]);
    expect(whereOptions(input(null)).byStep).toHaveLength(8);
    expect(whereOptions(input(null)).byStep.every((o) => o.disabledReason === null)).toBe(true);
  });

  it("expands a shuffled step's targets when referenced from after the range", () => {
    const p3 = whereOptions(input(7)).byStep.find((o) => o.label.startsWith("p3"))!;
    expect(p3.targets.map((t) => t.position)).toEqual([3, 4, 5]);
  });

  it("lists trials, qualified when a trial spans several routines", () => {
    const { byTrial } = whereOptions(input(7));
    expect(byTrial.map((o) => [o.label, o.disabledReason])).toEqual([
      ["t1 · intro, match, chat, end-match, debrief", null],
      ["t1:intro", null],
      ["t1:match", null],
      ["t1:chat", null],
      ["t1:end-match", null],
      ["t1:debrief", "t1: no earlier step of trial 1 before p7"],
      ["t2 · chat", null],
      ["t3 · chat, survey", null],
      ["t3:chat", null],
      ["t3:survey", null],
    ]);
    expect(whereOptions(input(4)).byTrial.find((o) => o.label === "t2 · chat")!.disabledReason)
      .toBe("t2 may run after p4: p4 is inside or before the shuffled range p3–p5");
  });
});

describe("elementOptions", () => {
  const stepAt = (n: number) => whereOptions(input(null)).byStep[n].targets[0];

  it("filters by kind and adds sub-fields per producer type", () => {
    expect(elementOptions([stepAt(0)], routines, "media").map((o) => o.name)).toEqual(["clip", "files"]);
    const all = elementOptions([stepAt(0)], routines, null);
    expect(all.find((o) => o.name === "q")!.fields).toEqual([{ value: "age", label: "age" }, { value: "mood", label: "mood" }]);
    expect(all.find((o) => o.name === "files")!.fields.map((f) => f.value)).toEqual(["0", "1", "count"]);
    expect(all.find((o) => o.name === "clip")!.fields.map((f) => f.value)).toEqual(["uploadId", "mimeType"]);
    expect(all.find((o) => o.name === "name")!.fields).toEqual([]);
  });
});

describe("elementOptions — video-chat tiles", () => {
  it("offers .text on a text tile and upload fields on a recorded tile", () => {
    const tiles: RoutineConfig = {
      name: "chat", type: "routine-card", layout: { rows: [] },
      elements: [
        { name: "cam", type: "video-chat", params: { record: true } },
        { name: "thread", type: "video-chat", params: { channels: ["text"] } },
        { name: "plain", type: "video-chat", params: {} },
      ],
    };
    const step = { position: 0, trial: 1, routine: "chat", rowIndex: 0, extraRowIndices: [], generated: false };
    const options = elementOptions([step], [tiles], null);
    expect(options.map((o) => [o.name, o.kind, o.fields.map((f) => f.value)])).toEqual([
      ["cam", "media", ["uploadId", "mimeType"]],
      ["thread", "value", ["text"]],
    ]);
  });

  it("offers a recorded text tile's transcript as a value under <tile>__transcript", () => {
    const tiles: RoutineConfig = {
      name: "chat", type: "routine-card", layout: { rows: [] },
      elements: [{ name: "talk", type: "video-chat", params: { record: true, channels: ["video", "text"] } }],
    };
    const step = { position: 0, trial: 1, routine: "chat", rowIndex: 0, extraRowIndices: [], generated: false };
    expect(elementOptions([step], [tiles], null).map((o) => [o.name, o.kind, o.fields.map((f) => f.value)])).toEqual([
      ["talk", "media", ["uploadId", "mimeType"]],
      ["talk__transcript", "value", ["text"]],
    ]);
    expect(elementOptions([step], [tiles], "value").map((o) => o.name)).toEqual(["talk__transcript"]);
  });
});

describe("buildRef", () => {
  it("formats a ref from the picker's choices and rejects a bad who", () => {
    expect(buildRef("partner:2", { kind: "trial", k: 2 }, "rec")).toBe("ref:partner:2/t2/rec");
    expect(buildRef("self", { kind: "position", n: 0 }, "q", "age")).toBe("ref:self/p0/q.age");
    expect(buildRef("partner:0", { kind: "position", n: 0 }, "q")).toBeNull();
  });
});
