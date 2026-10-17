import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import path from "path";
import prisma from "../prisma.js";
import { publicUploadRoutes } from "../routes/uploads.js";
import { mintMediaToken, verifyMediaToken, mediaUrlFor } from "../references/mediaToken.js";
import { JwtSecret, signToken } from "../middleware/auth.js";
import { UploadDir } from "../uploads/storage.js";
import { useTestServer } from "./helpers/httpTestServer.js";

vi.mock("../prisma.js", () => ({
  default: { upload: { findUnique: vi.fn() } },
}));

const app = express();
app.use("/api/uploads", publicUploadRoutes);
const server = useTestServer(app);

// Fixtures live inside the real UploadDir: the controller refuses any
// filePath outside it, so a "served" test needs a file that is really there.
const clipPath = path.join(UploadDir, "uploadRoutes-test-clip.webm");
const outsidePath = path.join(UploadDir, "..", "uploadRoutes-test-outside.webm");

beforeAll(() => {
  mkdirSync(UploadDir, { recursive: true });
  writeFileSync(clipPath, "WEBM-0123456789ABCDEF");
  writeFileSync(outsidePath, "NOT-SERVABLE");
});

afterAll(() => {
  rmSync(clipPath, { force: true });
  rmSync(outsidePath, { force: true });
});

const CompleteRow = {
  id: "u1",
  experimentId: "exp-1",
  participantId: "p1",
  fileName: "p0_t1_recorder-1.webm",
  mimeType: "video/webm",
  status: "COMPLETE",
  filePath: clipPath,
};

beforeEach(() => {
  vi.mocked(prisma.upload.findUnique).mockResolvedValue(CompleteRow as never);
});

describe("media token", () => {
  it("round-trips the upload id", () => {
    expect(verifyMediaToken(mintMediaToken("u1"))).toBe("u1");
  });

  it("rejects an expired token", () => {
    const expired = jwt.sign({ sub: "u1", use: "upload" }, JwtSecret, { expiresIn: -1 });
    expect(verifyMediaToken(expired)).toBeNull();
  });

  it("rejects an admin session token — different audience, same secret", () => {
    const admin = signToken({ experimenterId: "e1", email: "a@b.c" });
    expect(verifyMediaToken(admin)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyMediaToken("not-a-jwt")).toBeNull();
  });

  it("mediaUrlFor is a relative path carrying the token", () => {
    const url = mediaUrlFor("u1");
    expect(url.startsWith("/api/uploads/u1?token=")).toBe(true);
    expect(verifyMediaToken(url.split("token=")[1])).toBe("u1");
  });
});

describe("GET /api/uploads/:id", () => {
  it("streams a complete upload with its mimetype and supports ranges", async () => {
    const res = await request(server).get(mediaUrlFor("u1"));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("video/webm");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["accept-ranges"]).toBe("bytes");
    // superagent buffers a video/* response into `.body` (a Buffer), not
    // `.text` — `isBinary()` in its node HTTP client routes every
    // audio/font/image/video mimetype through the generic Buffer parser,
    // which never sets `.text`. See assetRoutes.test.ts, which hits the same
    // constraint for image/png and asserts headers rather than body text.
    expect(res.body.toString()).toBe("WEBM-0123456789ABCDEF");

    const partial = await request(server).get(mediaUrlFor("u1")).set("Range", "bytes=0-3");
    expect(partial.status).toBe(206);
    expect(partial.body.toString()).toBe("WEBM");
  });

  it("401s without a token", async () => {
    const res = await request(server).get("/api/uploads/u1");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("401s when the token names a different upload", async () => {
    const res = await request(server).get(`/api/uploads/u1?token=${mintMediaToken("u2")}`);
    expect(res.status).toBe(401);
  });

  it("404s an unknown row", async () => {
    vi.mocked(prisma.upload.findUnique).mockResolvedValue(null as never);
    const res = await request(server).get(mediaUrlFor("u1"));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("404s an upload that is still in flight", async () => {
    vi.mocked(prisma.upload.findUnique).mockResolvedValue({
      ...CompleteRow,
      status: "UPLOADING",
      filePath: null,
    } as never);
    const res = await request(server).get(mediaUrlFor("u1"));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("UPLOAD_NOT_READY");
  });

  it("refuses a filePath outside the upload directory", async () => {
    vi.mocked(prisma.upload.findUnique).mockResolvedValue({
      ...CompleteRow,
      filePath: outsidePath,
    } as never);
    const res = await request(server).get(mediaUrlFor("u1"));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("UPLOAD_OUTSIDE_DIR");
  });

  it("falls back to octet-stream for a malformed stored mimetype", async () => {
    vi.mocked(prisma.upload.findUnique).mockResolvedValue({
      ...CompleteRow,
      mimeType: "video/webm\r\nX-Injected: 1",
    } as never);
    const res = await request(server).get(mediaUrlFor("u1"));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/octet-stream");
  });

  it("serves a MediaRecorder mimetype with its codec parameters intact", async () => {
    vi.mocked(prisma.upload.findUnique).mockResolvedValue({
      ...CompleteRow,
      mimeType: "video/webm;codecs=vp8,opus",
    } as never);
    const res = await request(server).get(mediaUrlFor("u1"));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("video/webm;codecs=vp8,opus");
  });
});
