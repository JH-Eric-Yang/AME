import { describe, it, expect } from "vitest";
import { describeSource } from "../sourceState";
import type { AssetSummary } from "$lib/api";

const present: AssetSummary = {
  id: "a1",
  fileName: "stim_face_01.png",
  mimeType: "image/png",
  size: 421888,
  missing: false,
  createdAt: "2026-09-07T00:00:00.000Z",
};

const absent: AssetSummary = { ...present, id: "a2", fileName: "stim_07.png", missing: true };

const assets = [present, absent];

describe("describeSource", () => {
  it("is empty when no source is set", () => {
    expect(describeSource(undefined, assets)).toEqual({ kind: "empty" });
    expect(describeSource("", assets)).toEqual({ kind: "empty" });
  });

  it("resolves a reference to the asset it names", () => {
    expect(describeSource("asset:a1", assets)).toEqual({ kind: "asset", asset: present });
  });

  it("reports an asset whose file was never restored, by name", () => {
    expect(describeSource("asset:a2", assets)).toEqual({
      kind: "missing",
      assetId: "a2",
      fileName: "stim_07.png",
    });
  });

  it("reports a reference to an asset that no longer exists", () => {
    expect(describeSource("asset:deleted", assets)).toEqual({
      kind: "missing",
      assetId: "deleted",
      fileName: null,
    });
  });

  it("treats anything else as an external URL", () => {
    expect(describeSource("https://cdn.lab/x.png", assets)).toEqual({
      kind: "external",
      url: "https://cdn.lab/x.png",
    });
  });

  it("is missing, not empty, for a reference with no id", () => {
    expect(describeSource("asset:", assets)).toEqual({
      kind: "missing",
      assetId: "",
      fileName: null,
    });
  });

  it("recognises a reference to earlier data", () => {
    const state = describeSource("ref:self/p0/clip", []);
    expect(state.kind).toBe("reference");
    expect(state.kind === "reference" && state.parsed?.element).toBe("clip");
  });
});
