import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import adminRoutes from "../routes/admin.js";
import prisma from "../prisma.js";
import { signToken } from "../middleware/auth.js";
import { mintMediaToken } from "../references/mediaToken.js";
import { useTestServer } from "./helpers/httpTestServer.js";
import { UploadDir, tusFilePath, archiveEntryName } from "../uploads/storage.js";
import { recordUploadStarted, recordUploadFinished } from "../uploads/tusHooks.js";

vi.mock("../prisma.js", () => ({
  default: {
    experimenter: { findUnique: vi.fn() },
    experiment: { findFirst: vi.fn() },
    upload: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("../app.js", () => ({
  io: { of: () => ({ sockets: new Map() }) },
}));
vi.mock("../socket/progressHandler.js", () => ({
  deliverContent: vi.fn(),
}));

const app = express();
app.use(express.json());
app.use("/api/admin", adminRoutes);

const server = useTestServer(app);

const ExperimenterId = "exp-1";
const Token = signToken({ experimenterId: ExperimenterId, email: "test@test.com", role: "ADMIN" });
const AuthHeader = `Bearer ${Token}`;

const MockExperiment = { id: "test-exp-1", name: "Test Study" };

/** Supertest hands back a Buffer only when told the body is binary. */
function binaryParser(res: any, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
}

let fixtureDir: string;

beforeAll(() => {
  fixtureDir = mkdtempSync(path.join(tmpdir(), "ame-files-"));
});

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.experimenter.findUnique).mockResolvedValue({
    id: ExperimenterId,
    email: "test@test.com",
    password: "hash",
    name: "Test",
    role: "ADMIN",
    status: "APPROVED",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any);
});

describe("upload storage paths", () => {
  it("derives a tus upload's path from its id", () => {
    expect(tusFilePath("abc123")).toBe(path.join(UploadDir, "abc123"));
  });

  it("nests archive entries under the participant's responseId, the id the CSV uses", () => {
    expect(archiveEntryName({ responseId: "resp-1", fileName: "photo.jpg" })).toBe("resp-1/photo.jpg");
  });
});

describe("tus upload hooks", () => {
  const TusUpload = {
    id: "tus-id-1",
    size: 2048,
    offset: 2048,
    metadata: {
      experimentId: "test-exp-1",
      participantId: "p-1",
      progress: "3",
      trial: "2",
      elementName: "recorder1",
      filename: "p3_t2_recorder1.webm",
      mimeType: "video/webm",
    },
  };

  it("rejects an upload with no experiment or participant", async () => {
    await expect(recordUploadStarted({ id: "x", metadata: {} })).rejects.toMatchObject({
      status_code: 400,
    });
    expect(prisma.upload.create).not.toHaveBeenCalled();
  });

  it("records where the finished file landed, so the export can find it", async () => {
    await recordUploadStarted(TusUpload);
    await recordUploadFinished(TusUpload);

    expect(prisma.upload.update).toHaveBeenCalledWith({
      where: { id: "tus-id-1" },
      data: {
        status: "COMPLETE",
        totalSize: BigInt(2048),
        filePath: tusFilePath("tus-id-1"),
      },
    });
  });
});

describe("GET /api/admin/experiments/:id/export/files", () => {
  it("includes tus-uploaded files, one folder per participant responseId", async () => {
    const first = path.join(fixtureDir, "tus-id-1");
    const second = path.join(fixtureDir, "p-2", "clip.webm");
    writeFileSync(first, "first file");
    mkdirSync(path.dirname(second), { recursive: true });
    writeFileSync(second, "second file");

    vi.mocked(prisma.experiment.findFirst).mockResolvedValue(MockExperiment as any);
    vi.mocked(prisma.upload.findMany).mockResolvedValue([
      { participantId: "p-1", fileName: "clip.webm", filePath: first, participant: { responseId: "resp-1" } },
      { participantId: "p-2", fileName: "clip.webm", filePath: second, participant: { responseId: "resp-2" } },
    ] as any);

    const res = await request(server)
      .get("/api/admin/experiments/test-exp-1/export/files")
      .set("Authorization", AuthHeader)
      .buffer()
      .parse(binaryParser);

    expect(res.status).toBe(200);
    // Zip local file headers carry the entry name verbatim, so the archive's
    // bytes are enough to prove both files went in under distinct names.
    const archive = res.body.toString("latin1");
    expect(archive).toContain("resp-1/clip.webm");
    expect(archive).toContain("resp-2/clip.webm");
  });

  it("returns 404 when an upload row has no recorded path", async () => {
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue(MockExperiment as any);
    vi.mocked(prisma.upload.findMany).mockResolvedValue([
      { participantId: "p-1", fileName: "clip.webm", filePath: null },
    ] as any);

    const res = await request(server)
      .get("/api/admin/experiments/test-exp-1/export/files")
      .set("Authorization", AuthHeader);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NO_FILES");
  });
});

describe("downloading an export from the browser", () => {
  /** A browser download cannot send a header, so it carries a short-lived download token. */
  async function downloadToken(experimentId = "test-exp-1"): Promise<string> {
    const res = await request(server)
      .post(`/api/admin/experiments/${experimentId}/export/token`)
      .set("Authorization", AuthHeader);
    expect(res.status).toBe(200);
    return res.body.token;
  }

  beforeEach(() => {
    const file = path.join(fixtureDir, "download-clip");
    writeFileSync(file, "clip");
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue(MockExperiment as any);
    vi.mocked(prisma.upload.findMany).mockResolvedValue([
      { participantId: "p-1", fileName: "clip.webm", filePath: file, participant: { responseId: "resp-1" } },
    ] as any);
  });

  it("accepts a download token in the URL", async () => {
    const token = await downloadToken();

    const res = await request(server).get(`/api/admin/experiments/test-exp-1/export/files?token=${token}`);

    expect(res.status).toBe(200);
  });

  it("refuses a login token in the URL, so it never reaches a server log", async () => {
    const res = await request(server).get(`/api/admin/experiments/test-exp-1/export/files?token=${Token}`);

    expect(res.status).toBe(401);
  });

  it("refuses a download token for another experiment", async () => {
    vi.mocked(prisma.experiment.findFirst).mockResolvedValueOnce({ id: "other-exp", name: "Other" } as any);
    const token = await downloadToken("other-exp");

    const res = await request(server).get(`/api/admin/experiments/test-exp-1/export/files?token=${token}`);

    expect(res.status).toBe(401);
  });

  it("refuses a download token for a route that is not an export", async () => {
    const token = await downloadToken();

    const res = await request(server).get(`/api/admin/experiments/test-exp-1?token=${token}`);

    expect(res.status).toBe(401);
  });

  it("refuses a download token as a login header", async () => {
    const token = await downloadToken();

    const res = await request(server).get("/api/admin/experiments/test-exp-1").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it("refuses a participant's media token as a login header", async () => {
    // A participant sees this token in every stimulus URL; it must never open the dashboard API.
    const res = await request(server)
      .get("/api/admin/experiments/test-exp-1")
      .set("Authorization", `Bearer ${mintMediaToken("upload-1")}`);

    expect(res.status).toBe(401);
  });

  it("gives no download token for an experiment the experimenter does not own", async () => {
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue(null);

    const res = await request(server)
      .post("/api/admin/experiments/test-exp-1/export/token")
      .set("Authorization", AuthHeader);

    expect(res.status).toBe(404);
  });

  it("names the file safely when the experiment name is not ASCII", async () => {
    // Node throws on a non-Latin-1 header value, which made every export fail with a 500.
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue({ id: "test-exp-1", name: "Demo — Lecture 读书" } as any);

    const res = await request(server)
      .get("/api/admin/experiments/test-exp-1/export/files")
      .set("Authorization", AuthHeader)
      .buffer()
      .parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toBe(
      `attachment; filename="Demo _ Lecture _-files.zip"; filename*=UTF-8''${encodeURIComponent("Demo — Lecture 读书-files.zip")}`,
    );
  });
});
