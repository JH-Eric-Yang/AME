import { describe, it, expect } from "vitest";
import type { RoutineConfig, RoutineType, ElementConfig } from "ame-shared";
import { validateContentRows, isGeneratedRow, type ContentValidationRow } from "ame-shared/contentValidation";

const makeRoutine = (name: string, type: RoutineType, extra: Partial<RoutineConfig> = {}): RoutineConfig => ({
  name, type, layout: { rows: [] }, elements: [], ...extra,
});
const textElement = (name: string): ElementConfig => ({ name, type: "text", params: { content: "x" } });
const makeRow = (p: Partial<ContentValidationRow> & { progress: number; routine: string }): ContentValidationRow => ({
  trialNumber: 1, condition: "Basic", content: {}, description: null, ...p,
});
/** Canonical block: match at 0, seven rotating chats at 1-7, end-match at 8, end at 9. */
const bandRoutines = (chatExtra: Partial<RoutineConfig> = {}): RoutineConfig[] => [
  makeRoutine("Chat-match", "routine-matching"),
  makeRoutine("Chat", "routine-video-chat", chatExtra),
  makeRoutine("Chat-end-match", "routine-end-matching"),
  makeRoutine("Goodbye", "routine-end"),
];
const bandRows = (): ContentValidationRow[] => [
  makeRow({ progress: 0, routine: "Chat-match" }),
  ...Array.from({ length: 7 }, (_, i) => makeRow({ progress: 1 + i, trialNumber: i + 1, routine: "Chat" })),
  makeRow({ progress: 8, routine: "Chat-end-match" }),
  makeRow({ progress: 9, routine: "Goodbye" }),
];

describe("validateContentRows — per-row rules", () => {
  it("returns one warning list per row, index-parallel and empty when nothing is wrong", () => {
    const routines = [makeRoutine("Intro", "routine-card"), makeRoutine("Bye", "routine-end")];
    const rows = [makeRow({ progress: 0, routine: "Intro" }), makeRow({ progress: 1, routine: "Bye" })];
    const result = validateContentRows(rows, routines, ["Basic"]);
    expect(result.rowWarnings).toEqual([[], []]);
    expect(result.structuralWarnings).toEqual([]);
  });

  it("flags a routine name that is not on the experiment, and an empty one as required", () => {
    const routines = [makeRoutine("Bye", "routine-end")];
    const rows = [makeRow({ progress: 0, routine: "Ghost" }), makeRow({ progress: 1, routine: "" }), makeRow({ progress: 2, routine: "Bye" })];
    const result = validateContentRows(rows, routines, ["Basic"]);
    expect(result.rowWarnings[0]).toContain('Routine "Ghost" not found in experiment');
    expect(result.rowWarnings[1]).toContain("Routine is required");
    expect(result.rowWarnings[1].join(" ")).not.toContain("not found");
  });

  it("flags an undeclared condition but always accepts Basic", () => {
    const routines = [makeRoutine("Bye", "routine-end")];
    const rows = [
      makeRow({ progress: 0, routine: "Bye", condition: "Basic" }),
      makeRow({ progress: 0, routine: "Bye", condition: "Treatment" }),
    ];
    const result = validateContentRows(rows, routines, ["Control"]);
    expect(result.rowWarnings[0]).toEqual([]);
    expect(result.rowWarnings[1]).toContain('Condition "Treatment" not found in experiment');
  });

  it("flags content keys that name no element of the target routine", () => {
    const routines = [makeRoutine("Bye", "routine-end", { elements: [textElement("prompt")] })];
    const rows = [makeRow({ progress: 0, routine: "Bye", content: { prompt: "hi", subtitle: "x", note: "y" } })];
    expect(validateContentRows(rows, routines, ["Basic"]).rowWarnings[0]).toContain("Unknown content keys: subtitle, note");
  });

  it("flags both rows of a duplicate progress/trial/condition triple", () => {
    const routines = [makeRoutine("Bye", "routine-end")];
    const rows = [
      makeRow({ progress: 0, trialNumber: 2, routine: "Bye" }),
      makeRow({ progress: 0, trialNumber: 2, routine: "Bye" }),
      makeRow({ progress: 0, trialNumber: 3, routine: "Bye" }),
    ];
    const duplicate = "Duplicate: same progress, trial and condition as another row";
    const result = validateContentRows(rows, routines, ["Basic"]);
    expect(result.rowWarnings[0]).toContain(duplicate);
    expect(result.rowWarnings[1]).toContain(duplicate);
    expect(result.rowWarnings[2]).not.toContain(duplicate);
  });

  it("flags a negative progress and a trial number below one", () => {
    const rows = [makeRow({ progress: -1, trialNumber: 0, routine: "Bye" })];
    const result = validateContentRows(rows, [makeRoutine("Bye", "routine-end")], ["Basic"]);
    expect(result.rowWarnings[0]).toContain("Progress -1 must be a non-negative whole number");
    expect(result.rowWarnings[0]).toContain("Trial number 0 must be 1 or greater");
  });
});

describe("validateContentRows — structural rules", () => {
  it("warns when a condition's last progress is not a routine-end", () => {
    const rows = [makeRow({ progress: 0, routine: "Intro" })];
    const result = validateContentRows(rows, [makeRoutine("Intro", "routine-card")], ["Basic"]);
    expect(result.structuralWarnings).toEqual([{
      condition: "Basic",
      message: 'Condition "Basic": last progress (0) should use a routine-end to mark the end of the experiment',
    }]);
    expect(result.rowWarnings[0]).toContain("Last progress should use a routine-end routine");
  });

  it("warns when a video chat has no earlier routine-matching", () => {
    const rows = [
      makeRow({ progress: 1, routine: "Chat" }),
      makeRow({ progress: 2, routine: "Chat-end-match" }),
      makeRow({ progress: 3, routine: "Goodbye" }),
    ];
    const result = validateContentRows(rows, bandRoutines(), ["Basic"]);
    expect(result.structuralWarnings.map((w) => w.message)).toContain(
      'Condition "Basic": routine-video-chat at progress 1 needs a routine-matching at an earlier progress',
    );
    expect(result.rowWarnings[0]).toContain("Missing routine-matching before this video-chat");
  });

  it("warns when a video chat has no later routine-end-matching", () => {
    const rows = [
      makeRow({ progress: 1, routine: "Chat-match" }),
      makeRow({ progress: 2, routine: "Chat" }),
      makeRow({ progress: 3, routine: "Goodbye" }),
    ];
    const result = validateContentRows(rows, bandRoutines(), ["Basic"]);
    expect(result.structuralWarnings.map((w) => w.message)).toContain(
      'Condition "Basic": routine-video-chat at progress 2 needs a routine-end-matching at a later progress',
    );
    expect(result.rowWarnings[1]).toContain("Missing routine-end-matching after this video-chat");
  });

  it("keeps quiet about a complete matching band", () => {
    const result = validateContentRows(bandRows(), bandRoutines(), ["Basic"]);
    expect(result.structuralWarnings).toEqual([]);
    expect(result.rowWarnings.flat()).toEqual([]);
  });

  it("warns on the condition's first row when its positions are not 0..n-1", () => {
    const routines = [makeRoutine("Intro", "routine-card"), makeRoutine("Bye", "routine-end")];
    const rows = [makeRow({ progress: 0, routine: "Intro" }), makeRow({ progress: 2, routine: "Bye" })];
    const result = validateContentRows(rows, routines, ["Basic"]);
    expect(result.rowWarnings[0]).toEqual([
      'Condition "Basic": steps are numbered 0, 2; the runtime delivers positions 0..1 in order, so a gap ends the experiment early',
    ]);
    expect(result.rowWarnings[1]).toEqual([]);
  });

  it("scopes structural rules to each condition separately", () => {
    const routines = [makeRoutine("Intro", "routine-card"), makeRoutine("Bye", "routine-end")];
    const rows = [
      makeRow({ progress: 0, routine: "Intro", condition: "Control" }),
      makeRow({ progress: 1, routine: "Bye", condition: "Control" }),
      makeRow({ progress: 0, routine: "Intro", condition: "Treatment" }),
    ];
    const result = validateContentRows(rows, routines, ["Control", "Treatment"]);
    expect(result.structuralWarnings).toHaveLength(1);
    expect(result.structuralWarnings[0].condition).toBe("Treatment");
  });
});

describe("validateContentRows — round-robin band rule", () => {
  const roundRobinChat = { interactionPattern: { type: "round-robin" as const, groupSize: 2 } };

  it("accepts a round-robin trial enclosed by the matching band", () => {
    const result = validateContentRows(bandRows(), bandRoutines(roundRobinChat), ["Basic"]);
    expect(result.structuralWarnings).toEqual([]);
    expect(result.rowWarnings.flat()).toEqual([]);
  });

  it("warns when a round-robin trial sits after the band has closed", () => {
    const rows = [
      makeRow({ progress: 1, routine: "Chat-match" }),
      makeRow({ progress: 2, routine: "Chat" }),
      makeRow({ progress: 3, routine: "Chat-end-match" }),
      makeRow({ progress: 4, trialNumber: 2, routine: "Chat" }),
      makeRow({ progress: 5, routine: "Goodbye" }),
    ];
    const result = validateContentRows(rows, bandRoutines(roundRobinChat), ["Basic"]);
    expect(result.rowWarnings[1]).toEqual([]);
    expect(result.rowWarnings[3]).toContain("Round-robin rotation outside a routine-matching band");
    expect(result.structuralWarnings.map((w) => w.message)).toContain(
      'Condition "Basic": routine "Chat" rotates partners at progress 4, which is not inside a routine-matching → routine-end-matching band; the rotation index stays 0 and every trial repeats the first pairing',
    );
  });

  it("warns when a round-robin routine has no matching band at all", () => {
    const routines = [makeRoutine("Chat", "routine-video-chat", roundRobinChat), makeRoutine("Goodbye", "routine-end")];
    const rows = [makeRow({ progress: 0, routine: "Chat" }), makeRow({ progress: 1, routine: "Goodbye" })];
    expect(validateContentRows(rows, routines, ["Basic"]).rowWarnings[0]).toContain(
      "Round-robin rotation outside a routine-matching band",
    );
  });

  it("leaves a fixed-group video chat inside the band alone", () => {
    const routines = bandRoutines({ interactionPattern: { type: "fixed", groups: [[0, 1]] } });
    expect(validateContentRows(bandRows(), routines, ["Basic"]).rowWarnings.flat()).toEqual([]);
  });
});

describe("isGeneratedRow", () => {
  it("recognises a compiled block row by its description prefix", () => {
    expect(isGeneratedRow("block:design-1:3")).toBe(true);
  });
  it("treats hand-written, empty and absent descriptions as not generated", () => {
    expect(isGeneratedRow("practice trial")).toBe(false);
    expect(isGeneratedRow("")).toBe(false);
    expect(isGeneratedRow(null)).toBe(false);
    expect(isGeneratedRow(undefined)).toBe(false);
  });
});

describe("validateContentRows — references and extra trials", () => {
  const el = (name: string, type: ElementConfig["type"], extra: Partial<ElementConfig> = {}): ElementConfig =>
    ({ name, type, params: {}, ...extra }) as ElementConfig;
  const refRoutines = [
    makeRoutine("Intro", "routine-card", { elements: [el("name", "input-textfield"), el("clip", "recorder", { onsetTime: 300 })] }),
    makeRoutine("Recap", "routine-card", { elements: [el("replay", "video"), el("text", "text")] }),
    makeRoutine("Bye", "routine-end"),
  ];

  it("reports hard ref errors on the row that carries them, separately from warnings", () => {
    const rows = [
      makeRow({ progress: 0, routine: "Intro" }),
      makeRow({ progress: 1, routine: "Recap", content: { replay: { src: "ref:self/p0/name" }, text: { content: "{{ref:self/p0/clip}}" } } }),
      makeRow({ progress: 2, routine: "Bye" }),
    ];
    const result = validateContentRows(rows, refRoutines, ["Basic"]);
    expect(result.rowErrors).toEqual([
      [],
      ['`ref:self/p0/name`: a media source needs a recording or file, but "name" is a input-textfield'],
      [],
    ]);
    expect(result.rowWarnings[1]).toContain('`ref:self/p0/clip`: "clip" may not have run for every participant (onset at 300 ms)');
  });

  it("uses the condition's randomization ranges", () => {
    const rows = [
      makeRow({ progress: 0, routine: "Intro", trialNumber: 1 }),
      makeRow({ progress: 1, routine: "Intro", trialNumber: 2 }),
      makeRow({ progress: 2, routine: "Recap", trialNumber: 3, content: { text: { content: "{{ref:self/p1/name}}" } } }),
      makeRow({ progress: 3, routine: "Bye" }),
    ];
    const clean = validateContentRows(rows, refRoutines, ["Basic"], null);
    expect(clean.rowErrors[2]).toEqual([]);
    const shuffled = validateContentRows(rows, refRoutines, ["Basic"], { Basic: [{ fromTrial: 2, toTrial: 3, method: "shuffle" }] });
    expect(shuffled.rowErrors[2]).toEqual(["p1 and p2 are both in a shuffled range (p1–p2) and may swap; use t<K>"]);
  });

  it("warns on extra trial rows at one progress, which the runtime never delivers", () => {
    const rows = [
      makeRow({ progress: 0, routine: "Intro", trialNumber: 1 }),
      makeRow({ progress: 0, routine: "Intro", trialNumber: 2 }),
      makeRow({ progress: 1, routine: "Bye" }),
    ];
    const result = validateContentRows(rows, refRoutines, ["Basic"]);
    expect(result.rowWarnings[1]).toContain("Only the lowest trial (t1) at progress 0 is delivered; this row never runs");
    expect(result.rowWarnings[0].join(" ")).not.toContain("never runs");
    expect(result.rowErrors).toEqual([[], [], []]);
  });

  it("keeps rowErrors index-parallel and empty when there are no refs", () => {
    const rows = [makeRow({ progress: 0, routine: "Intro" }), makeRow({ progress: 1, routine: "Bye" })];
    expect(validateContentRows(rows, refRoutines, ["Basic"]).rowErrors).toEqual([[], []]);
  });
});
