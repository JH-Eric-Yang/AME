import { test, expect } from "@playwright/test";
import { escapeHtml, indexEntries, renderElementPage, renderIndex } from "./tutorials/kit/render";
import type { IndexEntry, RunInfo, TutorialManifest } from "./tutorials/kit/types";

/**
 * Tests of the tutorial page renderers. They are pure, so these tests need no
 * browser page: they read the HTML string.
 */

const Run: RunInfo = {
  recordedAt: "2026-10-12T21:01:00.000Z",
  build: "feat/element-e2e · 733a9d5",
  defined: ["input-slider"],
};

function manifest(overrides: Partial<TutorialManifest> = {}): TutorialManifest {
  return {
    type: "input-slider",
    label: "Slider",
    family: "response",
    summary: "The participant moves a handle along a scale.",
    steps: [
      { n: 1, stage: "Build", caption: "Open the Builder.", shot: "input-slider/step-1.png", atSec: 0 },
      { n: 2, stage: "Run", caption: "Move the slider to 8.", shot: "input-slider/step-2.png", atSec: 12.5 },
      { n: 3, stage: "Results", caption: "Open the Results tab.", shot: "input-slider/step-3.png", atSec: 40 },
    ],
    params: [{ key: "max", label: "Max", help: "Maximum slider value.", defaultValue: "100", value: "10" }],
    checks: ["The value is stored as a number."],
    stored: { "input-slider-2": 8 },
    defects: [],
    notes: [],
    video: "input-slider.mp4",
    durationSec: 52,
    passed: true,
    error: null,
    recordedAt: Run.recordedAt,
    build: Run.build,
    ...overrides,
  };
}

/** The text of the first match of `pattern`'s group, or the whole page when absent. */
const order = (html: string, words: string[]) => words.map((w) => html.indexOf(w));

test.describe("tutorial element page", () => {
  test("lists the steps in order under their stages", () => {
    const html = renderElementPage(manifest());
    const at = order(html, ["Open the Builder.", "Move the slider to 8.", "Open the Results tab."]);
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).toContain('id="stage-build"');
    expect(html).toContain('<video controls');
    expect(html).toContain('src="input-slider.mp4"');
  });

  test("escapes HTML in a caption", () => {
    expect(escapeHtml(`<b>"Tom" & 'Ann'</b>`)).toBe("&lt;b&gt;&quot;Tom&quot; &amp; &#39;Ann&#39;&lt;/b&gt;");
    const html = renderElementPage(
      manifest({ steps: [{ n: 1, stage: "Build", caption: "Type <b>Ann & Tom</b>.", shot: "x.png", atSec: 0 }] }),
    );
    expect(html).toContain("Type &lt;b&gt;Ann &amp; Tom&lt;/b&gt;.");
    expect(html).not.toContain("<b>Ann");
  });

  test("a failed run shows the error and no video", () => {
    const html = renderElementPage(manifest({ passed: false, video: null, error: "Timeout 5000ms" }));
    expect(html).toContain("The run failed");
    expect(html).toContain("Timeout 5000ms");
    expect(html).not.toContain("<video");
  });

  test("a failed run shows its failure screen without terminal colour codes", () => {
    const esc = String.fromCharCode(27);
    const html = renderElementPage(
      manifest({ passed: false, video: null, error: `${esc}[31mExpected: 8${esc}[39m`, failureShot: "input-slider/failure.png" }),
    );
    expect(html).toContain('src="input-slider/failure.png"');
    expect(html).toContain("Expected: 8");
    expect(html).not.toContain(esc);
  });

  test("names a known defect", () => {
    const html = renderElementPage(manifest({ defects: ["E2E-D4: no play control when autoplay is blocked."] }));
    expect(html).toContain("E2E-D4: no play control when autoplay is blocked.");
  });
});

test.describe("tutorial index entries", () => {
  const passed = manifest({ type: "text", label: "Text", family: "stimulus" });

  test("a defined tutorial without a manifest is failed, not planned", () => {
    const entries = indexEntries(["text", "timer", "recorder"], [passed], ["text", "timer"], () => "phase 3");
    expect(entries.map((e) => [e.type, e.status, e.note])).toEqual([
      ["text", "ready", ""],
      ["timer", "failed", "no result"],
      ["recorder", "planned", "phase 3"],
    ]);
  });

  test("a manifest with a defect shows the defect id", () => {
    const withDefect = manifest({ type: "timer", label: "Timer", family: "monitor", defects: ["E2E-D6: unit."] });
    expect(indexEntries(["timer"], [withDefect], ["timer"], () => "")[0]).toMatchObject({ status: "defect", note: "E2E-D6" });
  });
});

test.describe("tutorial index", () => {
  const entries: IndexEntry[] = [
    { type: "timer", label: "Timer", family: "monitor", status: "ready", note: "", steps: 6, durationSec: 40, href: "timer.html" },
    { type: "text", label: "Text", family: "stimulus", status: "ready", note: "", steps: 5, durationSec: 30, href: "text.html" },
    { type: "audio", label: "Audio", family: "stimulus", status: "defect", note: "E2E-D4", steps: 7, durationSec: 41, href: "audio.html" },
    { type: "button", label: "Button", family: "response", status: "failed", note: "", steps: 3, durationSec: null, href: "button.html" },
    { type: "recorder", label: "Recorder", family: "response", status: "planned", note: "phase 3", steps: null, durationSec: null, href: null },
  ];

  test("groups the families in the order Stimulus, Response, Monitor", () => {
    const html = renderIndex(entries, Run);
    const at = order(html, ['id="family-stimulus"', 'id="family-response"', 'id="family-monitor"']);
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  test("links only the elements that have a page", () => {
    const html = renderIndex(entries, Run);
    expect(html).toContain('href="timer.html"');
    expect(html).not.toContain('href="null"');
    expect(html).toContain("Planned · phase 3");
    expect(html).toContain("Failed");
    expect(html).toContain("Defect E2E-D4");
  });

  test("shows the tally", () => {
    const html = renderIndex(entries, Run);
    expect(html).toContain("<b>2</b> ready");
    expect(html).toContain("<b>1</b> with a defect");
    expect(html).toContain("<b>1</b> failed");
    expect(html).toContain("<b>1</b> planned");
  });
});
