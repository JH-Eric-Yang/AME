import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import path from "path";
import {
  AssetDir,
  assetFilePath,
  MaxAssetBytes,
  isAllowedAssetType,
  unlinkAssetFile,
} from "../assets/storage.js";

describe("asset storage", () => {
  it("puts every asset flat under the asset directory", () => {
    expect(assetFilePath("7f3a91c2")).toBe(path.join(AssetDir, "7f3a91c2"));
  });

  it("keeps assets out of the participant upload directory", () => {
    // uploads/ holds participant recordings and is served by nothing public.
    expect(AssetDir.endsWith(path.join("server", "assets"))).toBe(true);
    expect(AssetDir).not.toContain(`${path.sep}uploads`);
  });

  it("caps an upload at 500 MB", () => {
    expect(MaxAssetBytes).toBe(500 * 1024 * 1024);
  });

  it("accepts stimulus media types", () => {
    expect(isAllowedAssetType("image/png")).toBe(true);
    expect(isAllowedAssetType("video/mp4")).toBe(true);
    expect(isAllowedAssetType("audio/wav")).toBe(true);
  });

  it("rejects anything that is not stimulus media", () => {
    expect(isAllowedAssetType("application/pdf")).toBe(false);
    expect(isAllowedAssetType("text/html")).toBe(false);
    expect(isAllowedAssetType("")).toBe(false);
  });

  it("rejects a mimetype that is not a well-formed type/subtype", () => {
    // tus metadata is arbitrary base64-decoded UTF-8, so a prefix check alone
    // would store these — and the stored value goes straight to res.setHeader.
    expect(isAllowedAssetType("image/png\r\nX-Injected: pwned")).toBe(false);
    expect(isAllowedAssetType("image/png\nX-Injected: pwned")).toBe(false);
    expect(isAllowedAssetType("image/png; charset=utf-8")).toBe(false);
    expect(isAllowedAssetType("image/")).toBe(false);
    expect(isAllowedAssetType("image/png/extra")).toBe(false);
  });
});

describe("unlinkAssetFile", () => {
  const payload = path.join(AssetDir, "assetStorage-test-stim.png");
  const sidecar = `${payload}.json`;

  it("removes the payload and the tus metadata sidecar beside it", async () => {
    mkdirSync(AssetDir, { recursive: true });
    writeFileSync(payload, "PNGDATA");
    // @tus/file-store's FileKvStore resolves a key to <filePath>.json, so a
    // finished upload always leaves this second file next to the bytes.
    writeFileSync(sidecar, JSON.stringify({ id: "assetStorage-test-stim.png" }));

    await unlinkAssetFile(payload);

    expect(existsSync(payload)).toBe(false);
    expect(existsSync(sidecar)).toBe(false);
  });

  it("is a no-op when neither file is there", async () => {
    rmSync(payload, { force: true });
    rmSync(sidecar, { force: true });

    await expect(unlinkAssetFile(payload)).resolves.toBeUndefined();
  });

  it("removes the payload even when no sidecar was written", async () => {
    mkdirSync(AssetDir, { recursive: true });
    writeFileSync(payload, "PNGDATA");

    await unlinkAssetFile(payload);

    expect(existsSync(payload)).toBe(false);
  });
});
