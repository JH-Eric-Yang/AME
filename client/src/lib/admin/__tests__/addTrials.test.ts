import { describe, it, expect } from "vitest";
import type { RoutineConfig } from "ame-shared";
import { trialTargets, sortByFileName, trialsPreview } from "../addTrials";

const routine = {
  name: "trial",
  type: "routine-card",
  layout: { rows: [{ columns: [{ span: 12 }] }] },
  elements: [
    { name: "stim", type: "image", params: { src: "" } },
    { name: "rec", type: "recorder", params: {} },
    { name: "prompt", type: "text", params: { content: "" } },
  ],
} as unknown as RoutineConfig;

describe("trialTargets", () => {
  it("lists every stimulus param of every element, with its media kind", () => {
    expect(trialTargets(routine).map((t) => [t.key, t.label, t.media])).toEqual([
      ["stim.src", "stim · src", "image"],
      ["stim.alt", "stim · alt", null],
      ["prompt.content", "prompt · content", null],
    ]);
  });
});

describe("sortByFileName", () => {
  it("sorts numbers inside names by value and does not change its input", () => {
    const files = [{ fileName: "img10.png" }, { fileName: "img2.png" }, { fileName: "Img1.png" }];
    expect(sortByFileName(files).map((f) => f.fileName)).toEqual(["Img1.png", "img2.png", "img10.png"]);
    expect(files[0].fileName).toBe("img10.png");
  });
});

describe("trialsPreview", () => {
  const [stim] = trialTargets(routine);

  it("names the count, the positions, the routine and the param", () => {
    expect(trialsPreview(40, 3, "trial", stim)).toBe('Adds 40 steps, p3–p42, routine "trial", each overriding stim.src');
  });

  it("uses the singular for one step", () => {
    expect(trialsPreview(1, 0, "trial", stim)).toBe('Adds 1 step, p0, routine "trial", overriding stim.src');
  });
});
