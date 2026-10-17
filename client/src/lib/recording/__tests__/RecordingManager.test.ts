import { describe, it, expect, vi, beforeEach } from "vitest";
import { RecordingManager, type RecordingConfig } from "../RecordingManager";
import { getSocket } from "$lib/socket/experimentSocket";

// Mock external dependencies that use SvelteKit path aliases
vi.mock("$lib/upload/tusClient", () => ({
  startUpload: vi.fn(),
  saveToDevice: vi.fn(),
}));

vi.mock("$lib/socket/experimentSocket", () => ({
  getSocket: vi.fn(() => null),
}));

// Mock MediaRecorder
class MockMediaRecorder {
  static lastOptions: MediaRecorderOptions | undefined;
  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    MockMediaRecorder.lastOptions = options;
  }
  state = "inactive" as "inactive" | "recording" | "paused";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType = "video/webm";

  start(_timeslice?: number) {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.onstop?.();
  }
  addEventListener() {}
  removeEventListener() {}
}

vi.stubGlobal("MediaRecorder", MockMediaRecorder);

const BaseConfig: RecordingConfig = {
  uploadMode: "on-stop",
  experimentId: "exp-1",
  participantId: "p-1",
  progress: 1,
  trial: 1,
  elementName: "test-recorder",
};

describe("RecordingManager", () => {
  let stream: MediaStream;

  beforeEach(() => {
    stream = {
      getTracks: () => [{ getSettings: () => ({ frameRate: 30 }) }],
      getVideoTracks: () => [{ getSettings: () => ({ frameRate: 30 }) }],
    } as unknown as MediaStream;
  });

  it("starts and stops recording", () => {
    const manager = new RecordingManager(stream, BaseConfig);
    expect(manager.recording).toBe(false);

    manager.start();
    expect(manager.recording).toBe(true);

    manager.stop();
    expect(manager.recording).toBe(false);
  });

  it("calls onStateChange when recording state changes", () => {
    const onStateChange = vi.fn();
    const manager = new RecordingManager(stream, BaseConfig);
    manager.onStateChange = onStateChange;

    manager.start();
    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({ recording: true }),
    );

    manager.stop();
    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({ recording: false }),
    );
  });

  it("is idle before start", () => {
    const manager = new RecordingManager(stream, BaseConfig);
    expect(manager.uploadStatus).toBe("idle");
    expect(manager.uploadProgress).toBe(0);
  });

  it("disposes cleanly", () => {
    const manager = new RecordingManager(stream, BaseConfig);
    manager.start();
    manager.dispose();
    expect(manager.recording).toBe(false);
  });

  it("records at a fixed bitrate, so every browser makes chunks of the same size", () => {
    // A 3 s streaming chunk at 2.5 Mbit/s is about 1 MB, well under the server's message limit.
    new RecordingManager(stream, BaseConfig).start();
    expect(MockMediaRecorder.lastOptions).toEqual({ videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 });
  });

  it("prevents double start", () => {
    const manager = new RecordingManager(stream, BaseConfig);
    manager.start();
    manager.start(); // should not throw
    expect(manager.recording).toBe(true);
  });
});

describe("two streaming recordings on one socket", () => {
  /** One socket shared by both managers, as on the desktop. */
  function createFakeSocket() {
    const handlers = new Map<string, Array<(payload: unknown) => void>>();
    const sent: Array<{ event: string; payload: Record<string, unknown> }> = [];
    return {
      sent,
      on: (event: string, h: (payload: unknown) => void) => {
        handlers.set(event, [...(handlers.get(event) ?? []), h]);
      },
      off: (event: string, h: (payload: unknown) => void) => {
        handlers.set(event, (handlers.get(event) ?? []).filter((x) => x !== h));
      },
      emit: (event: string, payload: Record<string, unknown>) => { sent.push({ event, payload }); },
      reply: (event: string, payload: unknown) => (handlers.get(event) ?? []).forEach((h) => h(payload)),
    };
  }

  const stream = {
    getTracks: () => [{ getSettings: () => ({ frameRate: 30 }) }],
    getVideoTracks: () => [{ getSettings: () => ({ frameRate: 30 }) }],
  } as unknown as MediaStream;

  it("each recording finishes the upload the server opened for it", () => {
    const socket = createFakeSocket();
    vi.mocked(getSocket).mockReturnValue(socket as never);
    const phone = new RecordingManager(stream, { ...BaseConfig, uploadMode: "streaming", elementName: "reading__phone" });
    const desktop = new RecordingManager(stream, { ...BaseConfig, uploadMode: "streaming", elementName: "reading__desktop" });

    phone.start();
    desktop.start();
    socket.reply("upload:ready", { uploadId: "u-phone", elementName: "reading__phone" });
    socket.reply("upload:ready", { uploadId: "u-desktop", elementName: "reading__desktop" });
    phone.stop();
    desktop.stop();

    const finished = socket.sent.filter((m) => m.event === "upload:finish").map((m) => m.payload.uploadId);
    expect(finished).toEqual(["u-phone", "u-desktop"]);
    vi.mocked(getSocket).mockReturnValue(null);
  });

  it("reports the file name the server stored, so the CSV matches the ZIP", () => {
    const socket = createFakeSocket();
    vi.mocked(getSocket).mockReturnValue(socket as never);
    const phone = new RecordingManager(stream, { ...BaseConfig, uploadMode: "streaming", elementName: "reading__phone" });

    phone.start();
    socket.reply("upload:ready", { uploadId: "u-phone", elementName: "reading__phone", fileName: "p1_t1_reading__phone_2026.webm" });
    phone.stop();

    expect(phone.getResponse().fileName).toBe("p1_t1_reading__phone_2026.webm");
    vi.mocked(getSocket).mockReturnValue(null);
  });
});
