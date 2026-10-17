import { describe, it, expect } from "vitest";
import type { RoutineConfig } from "ame-shared";
import {
  isAssetRef,
  assetIdFromRef,
  findAssetUsage,
  describeAssetUse,
  remapAssetRefs,
  type ContentRowRef,
} from "ame-shared/assetUsage";

const routines: RoutineConfig[] = [
  {
    name: "intro",
    type: "routine-card",
    layout: { rows: [{ columns: [{ span: 12 }] }] },
    elements: [
      { name: "logo", type: "image", params: { src: "asset:a1" } },
      { name: "blurb", type: "text", params: { content: "hello" } },
    ],
  },
  {
    name: "trial",
    type: "routine-card",
    layout: { rows: [{ columns: [{ span: 12 }] }] },
    elements: [
      { name: "stim", type: "image", params: { src: "asset:a1" } },
      { name: "clip", type: "video", params: { src: "asset:a2" } },
      { name: "ext", type: "image", params: { src: "https://cdn.lab/x.png" } },
      { name: "blank", type: "image", params: {} },
    ],
  },
];

const contents: ContentRowRef[] = [
  {
    progress: 2,
    trialNumber: 1,
    routine: "trial",
    // Session Designer writes design.trialContent[n] straight into this column,
    // so a per-trial stimulus reference lives at a researcher-chosen key.
    content: { prompt: "look", stimulus: { src: "asset:a3" } },
  },
  {
    progress: 4,
    trialNumber: 2,
    routine: "trial",
    content: { clips: ["asset:a3", "https://cdn.lab/x.mp4"] },
  },
  { progress: 6, trialNumber: 3, routine: "trial", content: {} },
];

describe("isAssetRef", () => {
  it("recognises an asset reference", () => {
    expect(isAssetRef("asset:a1")).toBe(true);
  });

  it("leaves an external URL alone", () => {
    expect(isAssetRef("https://cdn.lab/x.png")).toBe(false);
  });

  it("is false for a non-string", () => {
    expect(isAssetRef(undefined)).toBe(false);
    expect(isAssetRef(42)).toBe(false);
  });
});

describe("assetIdFromRef", () => {
  it("strips the prefix", () => {
    expect(assetIdFromRef("asset:a1")).toBe("a1");
  });
});

describe("findAssetUsage", () => {
  it("reports every element referencing each asset", () => {
    const usage = findAssetUsage(routines, []);

    expect(usage.get("a1")).toEqual([
      { source: "element", routine: "intro", element: "logo" },
      { source: "element", routine: "trial", element: "stim" },
    ]);
    expect(usage.get("a2")).toEqual([
      { source: "element", routine: "trial", element: "clip" },
    ]);
  });

  it("ignores external URLs and unset sources", () => {
    const usage = findAssetUsage(routines, []);

    expect(usage.size).toBe(2);
  });

  it("returns an empty map for an experiment with no routines or content", () => {
    expect(findAssetUsage([], []).size).toBe(0);
  });

  it("finds a reference no routine carries, anywhere in a content row's JSON", () => {
    // The whole point: an asset referenced only from a content row was
    // reported "unused" and deleted behind a bland confirmation.
    const usage = findAssetUsage(routines, contents);

    expect(usage.get("a3")).toEqual([
      { source: "content", routine: "trial", progress: 2, trialNumber: 1 },
      { source: "content", routine: "trial", progress: 4, trialNumber: 2 },
    ]);
  });

  it("keeps element and content uses of the same asset distinguishable", () => {
    const usage = findAssetUsage(routines, [
      { progress: 2, trialNumber: 1, routine: "trial", content: { src: "asset:a1" } },
    ]);

    expect(usage.get("a1")).toEqual([
      { source: "element", routine: "intro", element: "logo" },
      { source: "element", routine: "trial", element: "stim" },
      { source: "content", routine: "trial", progress: 2, trialNumber: 1 },
    ]);
  });

  it("counts one row referencing the same asset twice only once", () => {
    const usage = findAssetUsage([], [
      {
        progress: 2,
        trialNumber: 1,
        routine: "trial",
        content: { a: "asset:a3", b: { c: "asset:a3" } },
      },
    ]);

    expect(usage.get("a3")).toHaveLength(1);
  });

  it("ignores external URLs and empty content rows", () => {
    expect(findAssetUsage([], contents).size).toBe(1);
  });
});

describe("describeAssetUse", () => {
  it("names an element by routine and element", () => {
    expect(
      describeAssetUse({ source: "element", routine: "trial", element: "stim" }),
    ).toBe("trial/stim");
  });

  it("names a content row by its progress and trial", () => {
    expect(
      describeAssetUse({
        source: "content",
        routine: "trial",
        progress: 2,
        trialNumber: 1,
      }),
    ).toBe("trial content (progress 2, trial 1)");
  });
});

describe("remapAssetRefs", () => {
  it("rewrites every reference and leaves everything else untouched", () => {
    const idMap = new Map([
      ["a1", "new1"],
      ["a2", "new2"],
    ]);

    const remapped = remapAssetRefs(routines, idMap);

    expect(remapped[0].elements[0].params).toEqual({ src: "asset:new1" });
    expect(remapped[1].elements[2].params).toEqual({ src: "https://cdn.lab/x.png" });
    expect(remapped[1].elements[1].params).toEqual({ src: "asset:new2" });
  });

  it("leaves a reference with no mapping alone", () => {
    const remapped = remapAssetRefs(routines, new Map());

    expect(remapped[0].elements[0].params).toEqual({ src: "asset:a1" });
  });

  it("walks arbitrary nested content, not just routines", () => {
    const content = { stimulus: { src: "asset:a1" }, note: "keep" };

    expect(remapAssetRefs(content, new Map([["a1", "new1"]]))).toEqual({
      stimulus: { src: "asset:new1" },
      note: "keep",
    });
  });

  it("does not mutate its input", () => {
    const original = { src: "asset:a1" };
    remapAssetRefs(original, new Map([["a1", "new1"]]));

    expect(original.src).toBe("asset:a1");
  });
});
