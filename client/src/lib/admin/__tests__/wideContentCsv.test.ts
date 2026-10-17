// client/src/lib/admin/__tests__/wideContentCsv.test.ts
import { describe, it, expect } from "vitest";
import type { RoutineConfig } from "ame-shared";
import type { AssetSummary } from "$lib/api";
import type { SequenceRow } from "ame-shared/progressSequence";
import { isLegacyCsv, parseWideCsv, writeWideCsv, starterCsv, csvFileName } from "../wideContentCsv";

const asset = (id: string, fileName: string): AssetSummary => ({
  id, fileName, mimeType: "image/png", size: 1, missing: false, createdAt: "2026-10-10T00:00:00Z",
});
const assets = [asset("a1", "cat.png"), asset("a2", "dog, brown.png"), asset("a3", "twin.png"), asset("a4", "twin.png")];

const trial: RoutineConfig = {
  name: "trial",
  type: "routine-card",
  layout: { rows: [{ columns: [{ span: 12 }] }] },
  elements: [
    { name: "stim", type: "image", params: { src: "asset:a1", alt: "" } },
    { name: "prompt", type: "text", params: { content: "Name the animal" } },
    { name: "go", type: "button", params: { label: "Next" } },
    { name: "wait", type: "timer", params: { duration: 3000 } },
  ],
} as RoutineConfig;
const routines = [trial];
const Header = "progress,trialNumber,routine,condition";

describe("isLegacyCsv", () => {
  it("is true for the JSON format, with or without its header", () => {
    expect(isLegacyCsv("progress,trialNumber,routine,condition,content\n0,1,a,Basic,{}")).toBe(true);
    expect(isLegacyCsv('0,1,a,Basic,{"x":1}')).toBe(true);
  });

  it("is false for the wide format, even with a BOM", () => {
    expect(isLegacyCsv(`\uFEFF${Header},prompt.content\n0,1,trial,Basic,Hi`)).toBe(false);
  });
});

describe("parseWideCsv", () => {
  it("ignores trailing empty header columns that Excel adds", () => {
    const text = `${Header},prompt.content,,\n0,1,trial,Basic,Hi,,\n1,1,trial,Basic,Yo,,`;
    const result = parseWideCsv(text, routines, assets);
    expect(result.error).toBeNull();
    expect(result.rows.map((r) => r.content)).toEqual([{ prompt: { content: "Hi" } }, { prompt: { content: "Yo" } }]);
  });

  it("refuses an unnamed column that holds data", () => {
    const text = `${Header},prompt.content,\n0,1,trial,Basic,Hi,stray`;
    expect(parseWideCsv(text, routines, assets)).toEqual({
      rows: [],
      error: "Line 1: column 6 has no name. Type <element>.<param> in its header cell.",
    });
  });

  it("skips a row of blank cells and keeps real line numbers", () => {
    const ok = `${Header},prompt.content\n0,1,trial,Basic,Hi\n,,,,\n1,1,trial,Basic,Yo`;
    expect(parseWideCsv(ok, routines, assets).rows.map((r) => r.progress)).toEqual([0, 1]);
    const bad = `${Header},prompt.content\n0,1,trial,Basic,Hi\n,,,,\nx,1,trial,Basic,Yo`;
    expect(parseWideCsv(bad, routines, assets).error).toBe('Line 4: progress "x" is not a whole number');
  });

  it("turns each param column into an override, typed by parameterHelp", () => {
    const text = `${Header},stim.src,prompt.content,wait.duration\n0,1,trial,Basic,cat.png,"Name it, then press Space",1500`;
    expect(parseWideCsv(text, routines, assets)).toEqual({
      error: null,
      rows: [{
        progress: 0, trialNumber: 1, routine: "trial", condition: "Basic",
        content: { stim: { src: "asset:a1" }, prompt: { content: "Name it, then press Space" }, wait: { duration: 1500 } },
      }],
    });
  });

  it("leaves an empty cell out of the override, and defaults trial and condition", () => {
    const text = `${Header},stim.src,prompt.content\n3,,trial,,,Only text`;
    expect(parseWideCsv(text, routines, assets).rows).toEqual([
      { progress: 3, trialNumber: 1, routine: "trial", condition: "Basic", content: { prompt: { content: "Only text" } } },
    ]);
  });

  it("finds a media file by its trimmed name, including one with a comma", () => {
    const text = `${Header},stim.src\n0,1,trial,Basic," cat.png "\n1,1,trial,Basic,"dog, brown.png"`;
    expect(parseWideCsv(text, routines, assets).rows.map((r) => r.content)).toEqual([
      { stim: { src: "asset:a1" } },
      { stim: { src: "asset:a2" } },
    ]);
  });

  it("passes a URL, an API path, a ref and an asset ref through unchanged", () => {
    const sources = ["https://x.org/a.png", "/api/uploads/u1", "ref:self/p0/clip", "asset:a3"];
    const text = [`${Header},stim.src`, ...sources.map((s, i) => `${i},1,trial,Basic,${s}`)].join("\n");
    expect(parseWideCsv(text, routines, assets).rows.map((r) => (r.content.stim as { src: string }).src)).toEqual(sources);
  });

  it.each([
    [`${Header},stim.src\n0,1,trail,Basic,cat.png`, 'Line 2: routine "trail" does not exist'],
    [`${Header},stim2.src\n0,1,trial,Basic,cat.png`, 'Line 2, column stim2.src: routine "trial" has no element "stim2"'],
    [`${Header},stim.source\n0,1,trial,Basic,cat.png`, 'Line 2, column stim.source: an image element has no param "source"'],
    [`${Header},wait.duration\n0,1,trial,Basic,abc`, 'Line 2, column wait.duration: "abc" is not a number'],
    [`${Header},stim.src\n0,1,trial,Basic,Cat.png`, 'Line 2, column stim.src: no uploaded file is named "Cat.png"'],
    [`${Header},stim.src\n0,1,trial,Basic,twin.png`, 'Line 2, column stim.src: 2 uploaded files are named "twin.png"; rename one in the asset library'],
    [`progress,routine\n0,trial`, "Line 1: the header must start with progress,trialNumber,routine,condition"],
    [`${Header},stimsrc\n0,1,trial,Basic,x`, 'Line 1: column "stimsrc" is not <element>.<param>'],
    [`${Header},stim.src,stim.src\n0,1,trial,Basic,x,y`, 'Line 1: column "stim.src" appears twice'],
    [`${Header}\nx,1,trial,Basic`, 'Line 2: progress "x" is not a whole number'],
  ])("refuses %j", (text, error) => {
    expect(parseWideCsv(text, routines, assets)).toEqual({ rows: [], error });
  });

  it("does not check an empty cell against the row's routine", () => {
    const other = { ...trial, name: "other", elements: [] } as RoutineConfig;
    const text = `${Header},stim.src\n0,1,other,Basic,`;
    expect(parseWideCsv(text, [trial, other], assets).error).toBeNull();
  });
});

describe("writeWideCsv", () => {
  const rows: SequenceRow[] = [
    { progress: 1, trialNumber: 2, routine: "trial", condition: "Basic", content: { stim: { src: "asset:a2" } } },
    { progress: 0, trialNumber: 1, routine: "trial", condition: "Basic", content: { prompt: { content: "Hi" }, stim: { src: "asset:a3" } } },
  ];

  it("writes one column per overridden param, file names for assets, and keeps an ambiguous asset ref", () => {
    expect(writeWideCsv(rows, routines, assets)).toBe(
      [`${Header},prompt.content,stim.src`, "0,1,trial,Basic,Hi,asset:a3", '1,2,trial,Basic,,"dog, brown.png"'].join("\r\n"),
    );
  });

  it("round-trips through parseWideCsv", () => {
    const parsed = parseWideCsv(writeWideCsv(rows, routines, assets), routines, assets);
    expect(parsed.error).toBeNull();
    expect(parsed.rows).toEqual([...rows].reverse().map(({ description: _d, ...r }) => r));
  });
});

describe("starterCsv", () => {
  it("has a column per stimulus param and two example rows of the routine defaults after the last step", () => {
    expect(starterCsv(trial, "Basic", 5, assets)).toBe(
      [
        `${Header},stim.src,stim.alt,prompt.content,go.label,wait.duration`,
        "5,1,trial,Basic,cat.png,,Name the animal,Next,3000",
        "6,1,trial,Basic,cat.png,,Name the animal,Next,3000",
      ].join("\r\n"),
    );
  });
});

describe("csvFileName", () => {
  it("makes a safe file name from the experiment name", () => {
    expect(csvFileName("Gesture Study #2", "trial-starter")).toBe("gesture-study-2-trial-starter.csv");
    expect(csvFileName("???", "sequence")).toBe("experiment-sequence.csv");
  });
});
