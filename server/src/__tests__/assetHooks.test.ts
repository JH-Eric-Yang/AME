import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "../prisma.js";
import { recordAssetStarted, recordAssetFinished } from "../assets/assetHooks.js";
import { assetFilePath } from "../assets/storage.js";

vi.mock("../prisma.js", () => ({
  default: {
    experiment: { findFirst: vi.fn() },
    asset: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  },
}));

const Owned = { id: "test-exp-1" };

function upload(metadata: Record<string, string>, id = "asset-id-1") {
  return { id, size: 1024, offset: 1024, metadata };
}

const ValidMeta = {
  experimentId: "test-exp-1",
  filename: "stim_face_01.png",
  mimeType: "image/png",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.experiment.findFirst).mockResolvedValue(Owned as any);
});

describe("recordAssetStarted", () => {
  it("creates a row keyed by the tus id", async () => {
    await recordAssetStarted(upload(ValidMeta), "exp-1");

    expect(prisma.asset.create).toHaveBeenCalledWith({
      data: {
        id: "asset-id-1",
        experimentId: "test-exp-1",
        fileName: "stim_face_01.png",
        mimeType: "image/png",
        size: BigInt(1024),
      },
    });
  });

  it("rejects an upload naming no experiment", async () => {
    await expect(
      recordAssetStarted(upload({ filename: "a.png", mimeType: "image/png" }), "exp-1"),
    ).rejects.toMatchObject({ status_code: 400 });
    expect(prisma.asset.create).not.toHaveBeenCalled();
  });

  it("rejects an experiment this experimenter does not own", async () => {
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue(null);

    await expect(recordAssetStarted(upload(ValidMeta), "someone-else")).rejects.toMatchObject({
      status_code: 403,
    });
    expect(prisma.asset.create).not.toHaveBeenCalled();
  });

  it("rejects a mimetype no element can present", async () => {
    await expect(
      recordAssetStarted(
        upload({ ...ValidMeta, mimeType: "application/pdf" }),
        "exp-1",
      ),
    ).rejects.toMatchObject({ status_code: 415 });
    expect(prisma.asset.create).not.toHaveBeenCalled();
  });

  it("rejects a mimetype carrying a header injection, before a byte is written", async () => {
    // tus metadata is arbitrary base64-decoded UTF-8. A stored CRLF would
    // reach res.setHeader on the next anonymous GET and throw after an await —
    // an unhandled rejection that ends the process.
    await expect(
      recordAssetStarted(
        upload({ ...ValidMeta, mimeType: "image/png\r\nX-Injected: pwned" }),
        "exp-1",
      ),
    ).rejects.toMatchObject({ status_code: 415 });
    expect(prisma.asset.create).not.toHaveBeenCalled();
  });

  it("restores an existing row instead of creating a second one", async () => {
    vi.mocked(prisma.asset.findFirst).mockResolvedValue({ id: "old-id" } as any);

    await recordAssetStarted(upload({ ...ValidMeta, assetId: "old-id" }, "old-id"), "exp-1");

    expect(prisma.asset.findFirst).toHaveBeenCalledWith({
      where: { id: "old-id", experimentId: "test-exp-1" },
      select: { id: true },
    });
    expect(prisma.asset.create).not.toHaveBeenCalled();
  });

  it("refuses to restore a row that is not in this experiment", async () => {
    vi.mocked(prisma.asset.findFirst).mockResolvedValue(null);

    await expect(
      recordAssetStarted(upload({ ...ValidMeta, assetId: "other" }, "other"), "exp-1"),
    ).rejects.toMatchObject({ status_code: 404 });
  });
});

describe("recordAssetFinished", () => {
  it("records where the file landed so the serving route can find it", async () => {
    await recordAssetFinished(upload(ValidMeta));

    expect(prisma.asset.update).toHaveBeenCalledWith({
      where: { id: "asset-id-1" },
      data: {
        filePath: assetFilePath("asset-id-1"),
        size: BigInt(1024),
        mimeType: "image/png",
      },
    });
  });
});
