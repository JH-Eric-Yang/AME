import { describe, it, expect } from "vitest";
import type { ElementConfig } from "ame-shared";
import { overrideOf, mergedParams, overridePatch, withOverride } from "../overrides";

const video = { name: "replay", type: "video", params: { src: "asset:a", controls: true } } as ElementConfig;

describe("overrideOf / mergedParams", () => {
  it("returns the element's override or null, and merges it over the defaults", () => {
    const content = { replay: { src: "ref:self/p0/clip" }, text: "not an object" };
    expect(overrideOf(content, "replay")).toEqual({ src: "ref:self/p0/clip" });
    expect(overrideOf(content, "text")).toBeNull();
    expect(overrideOf(content, "missing")).toBeNull();
    expect(mergedParams(video, content)).toEqual({ src: "ref:self/p0/clip", controls: true });
    expect(mergedParams(video, {})).toEqual({ src: "asset:a", controls: true });
  });
});

describe("overridePatch", () => {
  it("keeps only keys that differ from the defaults, by value", () => {
    expect(overridePatch({ src: "asset:a", controls: true }, { src: "asset:a", controls: false, loop: true })).toEqual({
      controls: false, loop: true,
    });
    expect(overridePatch({ a: [1, 2] }, { a: [1, 2] })).toEqual({});
  });

  it("drops a key the editor cleared, since a merge cannot delete a default", () => {
    expect(overridePatch({ src: "asset:a" }, { src: undefined })).toEqual({});
  });
});

describe("withOverride", () => {
  it("replaces or removes one element's entry without touching the rest", () => {
    const content = { replay: { src: "x" }, text: { content: "y" } };
    expect(withOverride(content, "replay", { loop: true })).toEqual({ replay: { loop: true }, text: { content: "y" } });
    expect(withOverride(content, "replay", null)).toEqual({ text: { content: "y" } });
    expect(content.replay).toEqual({ src: "x" });
  });
});
