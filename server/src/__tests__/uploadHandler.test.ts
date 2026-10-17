import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import prisma from "../prisma.js";

// Mock prisma
vi.mock("../prisma.js", () => ({
  default: {
    upload: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  },
}));

// Mock fs — provide a factory for createWriteStream that returns a controllable mock stream
const mockWrite = vi.fn((_chunk: unknown, cb?: () => void) => {
  if (cb) cb();
  return true;
});
const mockEnd = vi.fn((cb?: () => void) => {
  if (cb) cb();
});
const mockStream = { write: mockWrite, end: mockEnd };

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
    createWriteStream: vi.fn(() => mockStream),
  };
});

// Mock crypto
vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  return {
    ...actual,
    randomUUID: vi.fn(() => "test-upload-id"),
  };
});

// The suite runs with `mockReset: true`, which wipes an implementation
// declared once at module scope. Reinstall the ones these mocks are defined
// with before every test — this hook is outermost, so it runs before each
// describe block's own setup.
beforeEach(async () => {
  const fs = await import("fs");
  const crypto = await import("crypto");
  mockWrite.mockImplementation((_chunk: unknown, cb?: () => void) => {
    if (cb) cb();
    return true;
  });
  mockEnd.mockImplementation((cb?: () => void) => {
    if (cb) cb();
  });
  vi.mocked(fs.createWriteStream).mockReturnValue(
    mockStream as unknown as ReturnType<typeof fs.createWriteStream>,
  );
  vi.mocked(crypto.randomUUID).mockReturnValue("test-upload-id" as `${string}-${string}-${string}-${string}-${string}`);
});

// ── Helper to build a mock socket ──────────────────────

function createMockSocket(id = "socket-1") {
  const handlers = new Map<string, Function>();
  return {
    id,
    data: {} as Record<string, unknown>,
    on: vi.fn((event: string, handler: Function) => {
      handlers.set(event, handler);
    }),
    emit: vi.fn(),
    join: vi.fn(),
    to: vi.fn(() => ({ emit: vi.fn() })),
    disconnect: vi.fn(),
    _trigger: (event: string, ...args: unknown[]) => {
      const handler = handlers.get(event);
      if (handler) return handler(...args);
    },
    _handlers: handlers,
  };
}

function createMockNamespace() {
  return {
    to: vi.fn(() => ({ emit: vi.fn() })),
    fetchSockets: vi.fn(async () => []),
  };
}

function makeStartPayload(overrides: Record<string, unknown> = {}) {
  return {
    experimentId: "exp-1",
    participantId: "part-1",
    progress: 0,
    trial: 1,
    elementName: "recorder-1",
    timestamp: "2026-03-09T00:00:00.000Z",
    mimeType: "video/webm",
    ...overrides,
  };
}

// ── upload:start Tests ────────────────────────────────

describe("uploadHandler — upload:start", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(async () => {
    socket = createMockSocket();
    ns = createMockNamespace();
    socket.data = { experimentId: "exp-1", participantId: "part-1" };

    mockWrite.mockImplementation((_chunk: unknown, cb?: () => void) => {
      if (cb) cb();
      return true;
    });
    mockEnd.mockImplementation((cb?: () => void) => {
      if (cb) cb();
    });

    const { registerUploadHandler } = await import(
      "../socket/uploadHandler.js"
    );
    registerUploadHandler(ns as never, socket as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates directory, write stream, DB record, and emits upload:ready", async () => {
    const { mkdirSync, createWriteStream } = await import("fs");
    vi.mocked(prisma.upload.create).mockResolvedValue({} as never);

    await socket._trigger("upload:start", makeStartPayload());

    // Verify directory creation
    expect(mkdirSync).toHaveBeenCalledWith(expect.any(String), {
      recursive: true,
    });

    // Verify write stream creation
    expect(createWriteStream).toHaveBeenCalledWith(expect.any(String), {
      flags: "w",
    });

    // Verify DB record creation
    expect(prisma.upload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: "test-upload-id",
          experimentId: "exp-1",
          participantId: "part-1",
          progress: 0,
          trial: 1,
          elementName: "recorder-1",
          mimeType: "video/webm",
          status: "UPLOADING",
        }),
      }),
    );

    // Verify upload:ready names the upload and the recording it belongs to
    expect(socket.emit).toHaveBeenCalledWith("upload:ready", {
      uploadId: "test-upload-id",
      elementName: "recorder-1",
      fileName: expect.stringMatching(/recorder-1.*\.webm$/),
    });
  });

  it("does nothing if socket has no experimentId", async () => {
    socket.data = {};
    vi.mocked(prisma.upload.create).mockResolvedValue({} as never);

    await socket._trigger("upload:start", makeStartPayload());

    expect(prisma.upload.create).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it("does nothing if socket has no participantId", async () => {
    socket.data = { experimentId: "exp-1" };
    vi.mocked(prisma.upload.create).mockResolvedValue({} as never);

    await socket._trigger("upload:start", makeStartPayload());

    expect(prisma.upload.create).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it("emits upload:error when DB create fails", async () => {
    vi.mocked(prisma.upload.create).mockRejectedValue(
      new Error("DB connection lost"),
    );

    await socket._trigger("upload:start", makeStartPayload());

    expect(socket.emit).toHaveBeenCalledWith("upload:error", {
      uploadId: "",
      message: "DB connection lost",
    });
  });

  it("emits generic upload:error when non-Error is thrown", async () => {
    vi.mocked(prisma.upload.create).mockRejectedValue("string-error");

    await socket._trigger("upload:start", makeStartPayload());

    expect(socket.emit).toHaveBeenCalledWith("upload:error", {
      uploadId: "",
      message: "Failed to start upload",
    });
  });

  it("builds file path with correct components", async () => {
    const { createWriteStream } = await import("fs");
    vi.mocked(prisma.upload.create).mockResolvedValue({} as never);

    await socket._trigger(
      "upload:start",
      makeStartPayload({
        progress: 2,
        trial: 3,
        elementName: "my-recorder",
        timestamp: "2026-01-01T12:00:00.000Z",
      }),
    );

    // Verify the file path passed to createWriteStream includes expected components
    const callArgs = vi.mocked(createWriteStream).mock.calls;
    const filePath = callArgs[callArgs.length - 1][0] as string;
    expect(filePath).toContain("exp-1");
    expect(filePath).toContain("part-1");
    expect(filePath).toContain("p2_t3_my-recorder_2026-01-01T12:00:00.000Z");
    expect(filePath).toMatch(/\.webm$/);
  });
});

// ── upload:chunk Tests ────────────────────────────────

describe("uploadHandler — upload:chunk", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(async () => {
    socket = createMockSocket();
    ns = createMockNamespace();
    socket.data = { experimentId: "exp-1", participantId: "part-1" };

    mockWrite.mockImplementation((_chunk: unknown, cb?: () => void) => {
      if (cb) cb();
      return true;
    });
    mockEnd.mockImplementation((cb?: () => void) => {
      if (cb) cb();
    });

    const { registerUploadHandler } = await import(
      "../socket/uploadHandler.js"
    );
    registerUploadHandler(ns as never, socket as never);

    // Start an upload to populate ActiveUploads
    vi.mocked(prisma.upload.create).mockResolvedValue({} as never);
    await socket._trigger("upload:start", makeStartPayload());
    socket.emit.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes data to stream and emits upload:chunk:ack", async () => {
    const chunkData = new ArrayBuffer(10);

    await socket._trigger("upload:chunk", {
      uploadId: "test-upload-id",
      chunkIndex: 0,
      data: chunkData,
    });

    // stream.write should have been called
    expect(mockWrite).toHaveBeenCalled();

    // Should emit ack with correct bytesReceived
    expect(socket.emit).toHaveBeenCalledWith("upload:chunk:ack", {
      uploadId: "test-upload-id",
      chunkIndex: 0,
      bytesReceived: 10,
    });
  });

  it("tracks cumulative bytesReceived across multiple chunks", async () => {
    const chunk1 = new ArrayBuffer(100);
    const chunk2 = new ArrayBuffer(200);

    await socket._trigger("upload:chunk", {
      uploadId: "test-upload-id",
      chunkIndex: 0,
      data: chunk1,
    });

    await socket._trigger("upload:chunk", {
      uploadId: "test-upload-id",
      chunkIndex: 1,
      data: chunk2,
    });

    expect(socket.emit).toHaveBeenCalledWith("upload:chunk:ack", {
      uploadId: "test-upload-id",
      chunkIndex: 1,
      bytesReceived: 300,
    });
  });

  it("emits upload:error for unknown uploadId", () => {
    socket._trigger("upload:chunk", {
      uploadId: "unknown-id",
      chunkIndex: 0,
      data: new ArrayBuffer(10),
    });

    expect(socket.emit).toHaveBeenCalledWith("upload:error", {
      uploadId: "unknown-id",
      message: "Unknown upload ID",
    });
  });

  it("emits ack with current state for duplicate chunk index", async () => {
    // Send chunk 0 first
    await socket._trigger("upload:chunk", {
      uploadId: "test-upload-id",
      chunkIndex: 0,
      data: new ArrayBuffer(50),
    });

    socket.emit.mockClear();

    // Send duplicate chunk 0 — should ack with current state, not write again
    await socket._trigger("upload:chunk", {
      uploadId: "test-upload-id",
      chunkIndex: 0,
      data: new ArrayBuffer(50),
    });

    expect(socket.emit).toHaveBeenCalledWith("upload:chunk:ack", {
      uploadId: "test-upload-id",
      chunkIndex: 0,
      bytesReceived: 50,
    });
  });

  it("rejects chunk with index less than lastChunkIndex", async () => {
    // Send chunks 0 and 1
    await socket._trigger("upload:chunk", {
      uploadId: "test-upload-id",
      chunkIndex: 0,
      data: new ArrayBuffer(10),
    });
    await socket._trigger("upload:chunk", {
      uploadId: "test-upload-id",
      chunkIndex: 1,
      data: new ArrayBuffer(20),
    });

    socket.emit.mockClear();
    const writeCountBefore = mockWrite.mock.calls.length;

    // Send old chunk 0 again — duplicate/stale
    await socket._trigger("upload:chunk", {
      uploadId: "test-upload-id",
      chunkIndex: 0,
      data: new ArrayBuffer(10),
    });

    // Should NOT write to stream again
    expect(mockWrite.mock.calls.length).toBe(writeCountBefore);

    // Should ack with current state (lastChunkIndex=1)
    expect(socket.emit).toHaveBeenCalledWith("upload:chunk:ack", {
      uploadId: "test-upload-id",
      chunkIndex: 1,
      bytesReceived: 30,
    });
  });
});

// ── upload:finish Tests ───────────────────────────────

describe("uploadHandler — upload:finish", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(async () => {
    socket = createMockSocket();
    ns = createMockNamespace();
    socket.data = { experimentId: "exp-1", participantId: "part-1" };

    mockWrite.mockImplementation((_chunk: unknown, cb?: () => void) => {
      if (cb) cb();
      return true;
    });
    mockEnd.mockImplementation((cb?: () => void) => {
      if (cb) cb();
    });

    const { registerUploadHandler } = await import(
      "../socket/uploadHandler.js"
    );
    registerUploadHandler(ns as never, socket as never);

    // Start an upload to populate ActiveUploads
    vi.mocked(prisma.upload.create).mockResolvedValue({} as never);
    await socket._trigger("upload:start", makeStartPayload());
    socket.emit.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("closes stream, updates DB to COMPLETE, and emits upload:complete", async () => {
    vi.mocked(prisma.upload.update).mockResolvedValue({} as never);

    await socket._trigger("upload:finish", { uploadId: "test-upload-id" });

    // stream.end should have been called
    expect(mockEnd).toHaveBeenCalled();

    // DB should be updated with COMPLETE status
    expect(prisma.upload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "test-upload-id" },
        data: expect.objectContaining({
          status: "COMPLETE",
          totalSize: BigInt(0),
        }),
      }),
    );

    // Should emit upload:complete
    expect(socket.emit).toHaveBeenCalledWith("upload:complete", {
      uploadId: "test-upload-id",
      filePath: expect.any(String),
    });
  });

  it("reports correct totalSize after chunks were written", async () => {
    vi.mocked(prisma.upload.update).mockResolvedValue({} as never);

    // Write some chunks first
    await socket._trigger("upload:chunk", {
      uploadId: "test-upload-id",
      chunkIndex: 0,
      data: new ArrayBuffer(100),
    });
    await socket._trigger("upload:chunk", {
      uploadId: "test-upload-id",
      chunkIndex: 1,
      data: new ArrayBuffer(200),
    });

    await socket._trigger("upload:finish", { uploadId: "test-upload-id" });

    expect(prisma.upload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalSize: BigInt(300),
        }),
      }),
    );
  });

  it("emits upload:error for unknown uploadId", async () => {
    await socket._trigger("upload:finish", { uploadId: "unknown-id" });

    expect(socket.emit).toHaveBeenCalledWith("upload:error", {
      uploadId: "unknown-id",
      message: "Unknown upload ID",
    });
  });

  it("emits upload:error when DB update fails", async () => {
    vi.mocked(prisma.upload.update).mockRejectedValue(
      new Error("DB failure"),
    );

    await socket._trigger("upload:finish", { uploadId: "test-upload-id" });

    expect(socket.emit).toHaveBeenCalledWith("upload:error", {
      uploadId: "test-upload-id",
      message: "Failed to finalize upload",
    });
  });

  it("removes upload from active map after completion", async () => {
    vi.mocked(prisma.upload.update).mockResolvedValue({} as never);

    await socket._trigger("upload:finish", { uploadId: "test-upload-id" });

    // Trying to send a chunk after finish should fail with unknown ID
    socket.emit.mockClear();
    socket._trigger("upload:chunk", {
      uploadId: "test-upload-id",
      chunkIndex: 0,
      data: new ArrayBuffer(10),
    });

    expect(socket.emit).toHaveBeenCalledWith("upload:error", {
      uploadId: "test-upload-id",
      message: "Unknown upload ID",
    });
  });

  it("removes upload from active map even when DB update fails", async () => {
    vi.mocked(prisma.upload.update).mockRejectedValue(
      new Error("DB failure"),
    );

    await socket._trigger("upload:finish", { uploadId: "test-upload-id" });

    // Trying to send a chunk after failed finish should fail with unknown ID
    socket.emit.mockClear();
    socket._trigger("upload:chunk", {
      uploadId: "test-upload-id",
      chunkIndex: 0,
      data: new ArrayBuffer(10),
    });

    expect(socket.emit).toHaveBeenCalledWith("upload:error", {
      uploadId: "test-upload-id",
      message: "Unknown upload ID",
    });
  });
});

// ── upload:resume Tests ───────────────────────────────

describe("uploadHandler — upload:resume", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(async () => {
    socket = createMockSocket();
    ns = createMockNamespace();
    socket.data = { experimentId: "exp-1", participantId: "part-1" };

    mockWrite.mockImplementation((_chunk: unknown, cb?: () => void) => {
      if (cb) cb();
      return true;
    });
    mockEnd.mockImplementation((cb?: () => void) => {
      if (cb) cb();
    });

    const { registerUploadHandler } = await import(
      "../socket/uploadHandler.js"
    );
    registerUploadHandler(ns as never, socket as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns current state for an in-memory active upload", async () => {
    // Start an upload first
    vi.mocked(prisma.upload.create).mockResolvedValue({} as never);
    await socket._trigger("upload:start", makeStartPayload());

    // Write a chunk
    await socket._trigger("upload:chunk", {
      uploadId: "test-upload-id",
      chunkIndex: 0,
      data: new ArrayBuffer(50),
    });

    socket.emit.mockClear();

    await socket._trigger("upload:resume", { uploadId: "test-upload-id" });

    expect(socket.emit).toHaveBeenCalledWith("upload:ready", {
      uploadId: "test-upload-id",
      bytesReceived: 50,
      lastChunkIndex: 0,
    });
  });

  it("reopens write stream from DB for a partial upload", async () => {
    const { createWriteStream } = await import("fs");

    vi.mocked(prisma.upload.findUnique).mockResolvedValue({
      id: "old-upload-id",
      status: "UPLOADING",
      filePath: "/some/path/file.webm",
      totalSize: BigInt(1024),
    } as never);

    await socket._trigger("upload:resume", { uploadId: "old-upload-id" });

    // Should open in append mode
    expect(createWriteStream).toHaveBeenCalledWith("/some/path/file.webm", {
      flags: "a",
    });

    expect(socket.emit).toHaveBeenCalledWith("upload:ready", {
      uploadId: "old-upload-id",
      bytesReceived: 1024,
      lastChunkIndex: -1,
    });
  });

  it("emits upload:error when DB record not found", async () => {
    vi.mocked(prisma.upload.findUnique).mockResolvedValue(null);

    await socket._trigger("upload:resume", { uploadId: "nonexistent-id" });

    expect(socket.emit).toHaveBeenCalledWith("upload:error", {
      uploadId: "nonexistent-id",
      message: "Upload not found or already complete",
    });
  });

  it("emits upload:error when upload is already COMPLETE", async () => {
    vi.mocked(prisma.upload.findUnique).mockResolvedValue({
      id: "done-id",
      status: "COMPLETE",
      filePath: "/some/path/file.webm",
      totalSize: BigInt(5000),
    } as never);

    await socket._trigger("upload:resume", { uploadId: "done-id" });

    expect(socket.emit).toHaveBeenCalledWith("upload:error", {
      uploadId: "done-id",
      message: "Upload not found or already complete",
    });
  });

  it("emits upload:error when DB lookup fails", async () => {
    vi.mocked(prisma.upload.findUnique).mockRejectedValue(
      new Error("DB down"),
    );

    await socket._trigger("upload:resume", { uploadId: "some-id" });

    expect(socket.emit).toHaveBeenCalledWith("upload:error", {
      uploadId: "some-id",
      message: "Failed to resume upload",
    });
  });
});

// ── disconnect Tests ──────────────────────────────────

describe("uploadHandler — disconnect", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(async () => {
    socket = createMockSocket();
    ns = createMockNamespace();
    socket.data = { experimentId: "exp-1", participantId: "part-1" };

    mockWrite.mockImplementation((_chunk: unknown, cb?: () => void) => {
      if (cb) cb();
      return true;
    });
    mockEnd.mockImplementation((cb?: () => void) => {
      if (cb) cb();
    });

    const { registerUploadHandler } = await import(
      "../socket/uploadHandler.js"
    );
    registerUploadHandler(ns as never, socket as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("closes streams and saves totalSize on disconnect", async () => {
    vi.mocked(prisma.upload.create).mockResolvedValue({} as never);
    vi.mocked(prisma.upload.update).mockResolvedValue({} as never);

    // Start an upload and send a chunk
    await socket._trigger("upload:start", makeStartPayload());
    await socket._trigger("upload:chunk", {
      uploadId: "test-upload-id",
      chunkIndex: 0,
      data: new ArrayBuffer(75),
    });

    // Reset to track disconnect-specific calls
    mockEnd.mockClear();

    await socket._trigger("disconnect");

    // stream.end should have been called
    expect(mockEnd).toHaveBeenCalled();

    // DB should be updated with current bytesReceived
    expect(prisma.upload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "test-upload-id" },
        data: { totalSize: BigInt(75) },
      }),
    );
  });

  it("ends only the disconnecting socket's own uploads, leaving another socket's upload untouched", async () => {
    const fs = await import("fs");
    const crypto = await import("crypto");

    const streamA = {
      write: vi.fn((_chunk: unknown, cb?: () => void) => {
        if (cb) cb();
        return true;
      }),
      end: vi.fn((cb?: () => void) => {
        if (cb) cb();
      }),
    };
    const streamB = {
      write: vi.fn((_chunk: unknown, cb?: () => void) => {
        if (cb) cb();
        return true;
      }),
      end: vi.fn((cb?: () => void) => {
        if (cb) cb();
      }),
    };

    vi.mocked(crypto.randomUUID)
      .mockReturnValueOnce(
        "upload-a" as `${string}-${string}-${string}-${string}-${string}`,
      )
      .mockReturnValueOnce(
        "upload-b" as `${string}-${string}-${string}-${string}-${string}`,
      );
    vi.mocked(fs.createWriteStream)
      .mockReturnValueOnce(
        streamA as unknown as ReturnType<typeof fs.createWriteStream>,
      )
      .mockReturnValueOnce(
        streamB as unknown as ReturnType<typeof fs.createWriteStream>,
      );

    vi.mocked(prisma.upload.create).mockResolvedValue({} as never);
    vi.mocked(prisma.upload.update).mockResolvedValue({} as never);

    const socketA = createMockSocket("socket-a");
    const socketB = createMockSocket("socket-b");
    socketA.data = { experimentId: "exp-1", participantId: "part-a" };
    socketB.data = { experimentId: "exp-1", participantId: "part-b" };

    const { registerUploadHandler } = await import(
      "../socket/uploadHandler.js"
    );
    registerUploadHandler(ns as never, socketA as never);
    registerUploadHandler(ns as never, socketB as never);

    await socketA._trigger(
      "upload:start",
      makeStartPayload({ participantId: "part-a" }),
    );
    await socketB._trigger(
      "upload:start",
      makeStartPayload({ participantId: "part-b" }),
    );

    // Only socket A disconnects.
    await socketA._trigger("disconnect");

    // Socket A's own stream was ended and its DB row saved.
    expect(streamA.end).toHaveBeenCalled();
    expect(prisma.upload.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "upload-a" } }),
    );

    // Socket B's stream must survive untouched — this is the assertion that
    // actually catches the bug: without socketId scoping, the disconnect
    // sweep ends every entry in the shared map, including socket B's.
    expect(streamB.end).not.toHaveBeenCalled();
    expect(prisma.upload.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "upload-b" } }),
    );

    // And socket B's ActiveUploads entry must still be present: a chunk for
    // it still succeeds instead of coming back "Unknown upload ID".
    socketB.emit.mockClear();
    await socketB._trigger("upload:chunk", {
      uploadId: "upload-b",
      chunkIndex: 0,
      data: new ArrayBuffer(10),
    });
    expect(socketB.emit).toHaveBeenCalledWith("upload:chunk:ack", {
      uploadId: "upload-b",
      chunkIndex: 0,
      bytesReceived: 10,
    });

    // Clean up socket B's entry so it doesn't leak into later tests.
    await socketB._trigger("disconnect");
  });
});

// ── disconnect Tests (device socket) ───────────────────

describe("uploadHandler — disconnect (device socket)", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(async () => {
    socket = createMockSocket();
    ns = createMockNamespace();
    // Recordings are always streamed from the desktop socket, never the
    // phone's — deviceMode marks this socket as the latter.
    socket.data = { experimentId: "exp-1", participantId: "part-1", deviceMode: "controller" };

    mockWrite.mockImplementation((_chunk: unknown, cb?: () => void) => {
      if (cb) cb();
      return true;
    });
    mockEnd.mockImplementation((cb?: () => void) => {
      if (cb) cb();
    });

    const { registerUploadHandler } = await import(
      "../socket/uploadHandler.js"
    );
    registerUploadHandler(ns as never, socket as never);
  });

  afterEach(async () => {
    // The guard under test skips the real cleanup, so the entry this test
    // starts would otherwise leak into any test that runs after it. Finish
    // the cleanup here, through a non-device socket, the way production code
    // would once the desktop itself disconnects.
    const plainSocket = createMockSocket("cleanup-socket");
    plainSocket.data = { experimentId: "exp-1", participantId: "part-1" };
    const { registerUploadHandler } = await import("../socket/uploadHandler.js");
    registerUploadHandler(createMockNamespace() as never, plainSocket as never);
    await plainSocket._trigger("disconnect");

    vi.restoreAllMocks();
  });

  it("does not close active upload streams when the device socket disconnects", async () => {
    vi.mocked(prisma.upload.create).mockResolvedValue({} as never);

    await socket._trigger("upload:start", makeStartPayload());
    mockEnd.mockClear();

    await socket._trigger("disconnect");

    expect(mockEnd).not.toHaveBeenCalled();
    expect(prisma.upload.update).not.toHaveBeenCalled();
  });
});
