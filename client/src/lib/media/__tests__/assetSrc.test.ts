import { describe, it, expect } from "vitest";
import { resolveSrc, assetRef } from "../assetSrc";
import { ServerUrl } from "$lib/config";

describe("resolveSrc", () => {
  it("turns an asset reference into a URL on the API server", () => {
    expect(resolveSrc("asset:7f3a91c2")).toBe(`${ServerUrl}/api/assets/7f3a91c2`);
  });

  it("passes an external URL through untouched", () => {
    expect(resolveSrc("https://cdn.lab/stim1.png")).toBe("https://cdn.lab/stim1.png");
  });

  it("passes a relative path through untouched", () => {
    expect(resolveSrc("/local/stim.png")).toBe("/local/stim.png");
  });

  it("returns an empty string for an unset source, so no request is made", () => {
    expect(resolveSrc(undefined)).toBe("");
    expect(resolveSrc(null)).toBe("");
    expect(resolveSrc("")).toBe("");
  });

  it("returns an empty string for a reference with no id", () => {
    expect(resolveSrc("asset:")).toBe("");
  });

  it("prefixes the API origin onto a resolved upload path", () => {
    expect(resolveSrc("/api/uploads/u1?token=T")).toBe(`${ServerUrl}/api/uploads/u1?token=T`);
  });
});

describe("assetRef", () => {
  it("builds the stored src for an asset id", () => {
    expect(assetRef("7f3a91c2")).toBe("asset:7f3a91c2");
  });

  it("round-trips through resolveSrc", () => {
    expect(resolveSrc(assetRef("7f3a91c2"))).toBe(`${ServerUrl}/api/assets/7f3a91c2`);
  });
});
