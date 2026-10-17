import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { mkdirSync, writeFileSync, rmSync, rmdirSync, existsSync } from "fs";
import path from "path";
import prisma from "../prisma.js";
import { adminAssetRoutes, publicAssetRoutes, resolveAssetUploadId } from "../routes/assets.js";
import { AssetDir } from "../assets/storage.js";
import { signToken } from "../middleware/auth.js";
import { useTestServer } from "./helpers/httpTestServer.js";

vi.mock("../prisma.js", () => ({
  default: {
    experiment: { findFirst: vi.fn() },
    asset: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
  },
}));

const app = express();
app.use(express.json());
app.use("/api/admin", adminAssetRoutes);
app.use("/api/assets", publicAssetRoutes);

const server = useTestServer(app);

const Token = signToken({ experimenterId: "exp-1", email: "a@b.com", role: "ADMIN" });
const AuthHeader = `Bearer ${Token}`;

// Fixtures live inside the real AssetDir (gitignored, created on demand), not
// an arbitrary tmp dir: `isInsideAssetDir` in the controller now rejects any
// filePath that resolves outside it, so a "served successfully" test needs a
// file that is actually there. `assetRoutes-test-` namespaces these against
// anything else that might write into the same shared directory.
const pngPath = path.join(AssetDir, "assetRoutes-test-stim.png");
const missingPath = path.join(AssetDir, "assetRoutes-test-gone.png");
const uploadDir = path.join(AssetDir, "..", "uploads");
const outsidePath = path.join(uploadDir, "assetRoutes-test-escaped.png");

/** True when this run had to create `uploads/`, so afterAll may remove it again. */
let createdUploadDir = false;

beforeAll(() => {
  mkdirSync(AssetDir, { recursive: true });
  writeFileSync(pngPath, "PNGDATA-0123456789");
  // The out-of-directory fixture must REALLY EXIST and be readable. If it did
  // not, `sendFile` would ENOENT and answer 404 all by itself — which is what
  // the containment branch answers too, so the guard could be deleted and this
  // suite would still pass. A readable file makes the two outcomes differ.
  createdUploadDir = !existsSync(uploadDir);
  mkdirSync(uploadDir, { recursive: true });
  writeFileSync(outsidePath, "RECORDING-NOT-YOURS");
  // missingPath must not exist, however a previous interrupted run left things.
  if (existsSync(missingPath)) rmSync(missingPath);
});

afterAll(() => {
  rmSync(pngPath, { force: true });
  rmSync(outsidePath, { force: true });
  // Only remove uploads/ if this run made it, and never recursively: uploads/
  // holds participant recordings, and a dev server could have written one into
  // this directory in the window between beforeAll and now. rmdirSync only
  // succeeds on an empty directory, so if anything else landed in there this
  // leaves it untouched.
  if (createdUploadDir) {
    try {
      rmdirSync(uploadDir);
    } catch {
      // Not empty (or already gone) — leave it alone.
    }
  }

  // The DELETE-route test relies on the route under test to remove these; if
  // that route ever regresses, sweep them here so a leak doesn't contaminate
  // the "server/assets/ is empty" check that stands as evidence cleanup works.
  const deletePayload = path.join(AssetDir, "assetRoutes-test-delete.png");
  const deleteSidecar = `${deletePayload}.json`;
  if (existsSync(deletePayload)) rmSync(deletePayload);
  if (existsSync(deleteSidecar)) rmSync(deleteSidecar);
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.experiment.findFirst).mockResolvedValue({ id: "test-exp-1" } as any);
});

describe("GET /api/admin/experiments/:id/assets", () => {
  it("lists an experiment's assets with BigInt sizes made JSON-safe", async () => {
    vi.mocked(prisma.asset.findMany).mockResolvedValue([
      {
        id: "a1",
        fileName: "stim.png",
        mimeType: "image/png",
        size: BigInt(18),
        filePath: "/tmp/stim.png",
        createdAt: new Date("2026-09-07T00:00:00Z"),
      },
    ] as any);

    const res = await request(server)
      .get("/api/admin/experiments/test-exp-1/assets")
      .set("Authorization", AuthHeader);

    expect(res.status).toBe(200);
    expect(res.body.assets).toEqual([
      {
        id: "a1",
        fileName: "stim.png",
        mimeType: "image/png",
        size: 18,
        missing: false,
        createdAt: "2026-09-07T00:00:00.000Z",
      },
    ]);
  });

  it("flags a row whose bytes never arrived", async () => {
    vi.mocked(prisma.asset.findMany).mockResolvedValue([
      {
        id: "a2",
        fileName: "gone.png",
        mimeType: "image/png",
        size: BigInt(0),
        filePath: null,
        createdAt: new Date("2026-09-07T00:00:00Z"),
      },
    ] as any);

    const res = await request(server)
      .get("/api/admin/experiments/test-exp-1/assets")
      .set("Authorization", AuthHeader);

    expect(res.body.assets[0].missing).toBe(true);
  });

  it("refuses an experiment this experimenter does not own", async () => {
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue(null);

    const res = await request(server)
      .get("/api/admin/experiments/other/assets")
      .set("Authorization", AuthHeader);

    expect(res.status).toBe(404);
  });

  it("refuses an anonymous caller", async () => {
    const res = await request(server).get("/api/admin/experiments/test-exp-1/assets");
    expect(res.status).toBe(401);
  });
});

describe("mounting", () => {
  it("does not authenticate unrelated /api/admin routes", async () => {
    // adminAssetRoutes mounts at /api/admin ahead of adminRoutes. If it used
    // router-level requireAuth, this anonymous request would 401 here instead
    // of falling through — which is exactly what would break login and signup.
    const res = await request(server).post("/api/admin/login").send({});

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/admin/assets/:assetId", () => {
  it("deletes an asset the experimenter owns", async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: "a1",
      experimentId: "test-exp-1",
      filePath: null,
    } as any);

    const res = await request(server)
      .delete("/api/admin/assets/a1")
      .set("Authorization", AuthHeader);

    expect(res.status).toBe(204);
    expect(prisma.asset.delete).toHaveBeenCalledWith({ where: { id: "a1" } });
  });

  it("unlinks the file and tus's .json sidecar, not just the row", async () => {
    const payload = path.join(AssetDir, "assetRoutes-test-delete.png");
    const sidecar = `${payload}.json`;
    writeFileSync(payload, "PNGDATA");
    writeFileSync(sidecar, JSON.stringify({ id: "assetRoutes-test-delete.png" }));

    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: "a1",
      experimentId: "test-exp-1",
      filePath: payload,
    } as any);

    const res = await request(server)
      .delete("/api/admin/assets/a1")
      .set("Authorization", AuthHeader);

    expect(res.status).toBe(204);
    expect(existsSync(payload)).toBe(false);
    expect(existsSync(sidecar)).toBe(false);
  });

  it("never unlinks a filePath that resolves outside the asset directory", async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: "a3",
      experimentId: "test-exp-1",
      filePath: outsidePath,
    } as any);

    const res = await request(server)
      .delete("/api/admin/assets/a3")
      .set("Authorization", AuthHeader);

    expect(res.status).toBe(204);
    // The row still goes; the participant recording it pointed at does not.
    expect(existsSync(outsidePath)).toBe(true);
  });

  it("refuses to delete an asset in someone else's experiment", async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: "a1",
      experimentId: "not-mine",
      filePath: null,
    } as any);
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue(null);

    const res = await request(server)
      .delete("/api/admin/assets/a1")
      .set("Authorization", AuthHeader);

    expect(res.status).toBe(404);
    expect(prisma.asset.delete).not.toHaveBeenCalled();
  });
});

describe("GET /api/assets/:assetId", () => {
  it("serves the file to an anonymous caller, because participants hold no token", async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: "a1",
      fileName: "stim.png",
      mimeType: "image/png",
      filePath: pngPath,
    } as any);

    const res = await request(server).get("/api/assets/a1");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
  });

  it("answers a Range request with 206, so video can seek", async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: "a1",
      fileName: "stim.png",
      mimeType: "image/png",
      filePath: pngPath,
    } as any);

    const res = await request(server).get("/api/assets/a1").set("Range", "bytes=0-3");

    expect(res.status).toBe(206);
    expect(res.headers["content-range"]).toBe("bytes 0-3/18");
  });

  it("reports a row whose bytes never arrived", async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: "a2",
      mimeType: "image/png",
      filePath: null,
    } as any);

    const res = await request(server).get("/api/assets/a2");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("ASSET_MISSING");
  });

  it("reports an unknown id", async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue(null);

    const res = await request(server).get("/api/assets/nope");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("sets defensive headers, so an image/svg+xml stimulus cannot script the API origin", async () => {
    // isAllowedAssetType only checks an `image/` prefix, so image/svg+xml is
    // accepted stimulus media even though an SVG can carry a <script>. These
    // headers are what neutralise that without banning SVG outright.
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: "a1",
      fileName: "stim.png",
      mimeType: "image/svg+xml",
      filePath: pngPath,
    } as any);

    const res = await request(server).get("/api/assets/a1");

    expect(res.status).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
    expect(res.headers["content-disposition"]).toBe('inline; filename="stim.png"');
  });

  it("cannot have its Content-Disposition header broken out of by a hostile fileName", async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: "a1",
      fileName: 'evil".svg"\r\nX-Injected: pwned',
      mimeType: "image/png",
      filePath: pngPath,
    } as any);

    const res = await request(server).get("/api/assets/a1");

    expect(res.status).toBe(200);
    expect(res.headers["x-injected"]).toBeUndefined();
    // No CR/LF reached the header value, and the only two `"` characters left
    // are the ones this route itself wraps the filename in — none from the
    // hostile input, so nothing could have closed the quoted value early.
    expect(res.headers["content-disposition"]).not.toMatch(/[\r\n]/);
    expect(res.headers["content-disposition"]?.match(/"/g)?.length).toBe(2);
  });

  it("refuses a filePath that resolves outside the asset directory", async () => {
    // outsidePath is a real, readable file under uploads/ — so a 404 here can
    // only come from the containment guard, never from a missing file. The
    // code is deliberately NOT `ASSET_MISSING`: the bytes are present, they
    // are simply somewhere this endpoint must never serve from.
    expect(existsSync(outsidePath)).toBe(true);

    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: "a3",
      fileName: "escaped.png",
      mimeType: "image/png",
      filePath: outsidePath,
    } as any);

    const res = await request(server).get("/api/assets/a3");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("ASSET_OUTSIDE_DIR");
    expect(res.text).not.toContain("RECORDING-NOT-YOURS");
  });

  it("does not crash on a stored mimetype carrying a CRLF", async () => {
    // A row can predate the allowlist's shape check, or come from an import.
    // Passing it to res.type() throws ERR_INVALID_CHAR inside setHeader, after
    // an await — an unhandled rejection that would take the process down.
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: "a5",
      fileName: "stim.png",
      mimeType: "image/png\r\nX-Injected: pwned",
      filePath: pngPath,
    } as any);

    const res = await request(server).get("/api/assets/a5");

    expect(res.status).toBe(200);
    expect(res.headers["x-injected"]).toBeUndefined();
    expect(res.headers["content-type"]).toBe("application/octet-stream");
  });

  it("returns the JSON 404 when the row's file is gone from disk, instead of falling through", async () => {
    vi.mocked(prisma.asset.findUnique).mockResolvedValue({
      id: "a4",
      fileName: "gone-from-disk.png",
      mimeType: "image/png",
      filePath: missingPath,
    } as any);

    const res = await request(server).get("/api/assets/a4");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("ASSET_MISSING");
  });
});

describe("resolveAssetUploadId", () => {
  it("accepts a metadata assetId shaped like a uuid v4", () => {
    const id = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
    expect(resolveAssetUploadId({ assetId: id })).toBe(id);
  });

  it("never lets a non-uuid assetId become the stored filesystem path", () => {
    const hostile = "../../uploads/someone-elses-recording.webm";
    const resolved = resolveAssetUploadId({ assetId: hostile });

    expect(resolved).not.toBe(hostile);
    expect(resolved).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it("falls back to a fresh id when metadata carries none", () => {
    expect(resolveAssetUploadId(undefined)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
