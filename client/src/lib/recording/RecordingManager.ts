/**
 * RecordingManager — shared recording + upload core.
 * Framework-agnostic (no Svelte dependency).
 * Used by both ElRecorder (single stream) and ElMultiCapture (multi-stream).
 */

import { startUpload, saveToDevice as tusaSaveToDevice } from "$lib/upload/tusClient";
import { getSocket } from "$lib/socket/experimentSocket";

export interface RecordingConfig {
  uploadMode: "on-stop" | "streaming";
  experimentId: string;
  participantId: string;
  progress: number;
  trial: number;
  elementName: string;
  maxDuration?: number;
}

export interface RecordingState {
  recording: boolean;
  uploadStatus: "idle" | "uploading" | "complete" | "failed";
  uploadProgress: number;
}

const StreamingChunkIntervalMs = 3000;
/**
 * Fixed bitrates, so a recording has the same quality in every browser and a
 * streaming chunk stays near 1 MB (3 s at 2.5 Mbit/s), under the server's
 * Socket.IO message limit (`MaxSocketMessageBytes` in `server/src/app.ts`).
 */
const RecordingVideoBitsPerSecond = 2_500_000;
const RecordingAudioBitsPerSecond = 128_000;

export class RecordingManager {
  private stream: MediaStream;
  private config: RecordingConfig;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private recordedBlob: Blob | null = null;
  private recordedMimeType = "video/webm";
  private recordingTimestamp = "";
  private sourceFrameRate: number | null = null;

  // Streaming state
  private streamingUploadId = "";
  /** The name the server stored a streaming upload under; it has no frame-rate tag. */
  private streamingFileName = "";
  private streamingChunkIndex = 0;

  // Public state
  recording = false;
  uploadStatus: "idle" | "uploading" | "complete" | "failed" = "idle";
  uploadProgress = 0;

  // Callbacks
  onStateChange: ((state: RecordingState) => void) | null = null;
  onUploadComplete: ((uploadId: string) => void) | null = null;
  onUploadFailed: (() => void) | null = null;

  constructor(stream: MediaStream, config: RecordingConfig) {
    this.stream = stream;
    this.config = config;

    // Capture source framerate
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      const settings = videoTrack.getSettings();
      this.sourceFrameRate = settings.frameRate ?? null;
    }
  }

  start(): void {
    if (this.recording) return;

    this.chunks = [];
    this.recordingTimestamp = new Date().toISOString();
    this.recorder = new MediaRecorder(this.stream, {
      videoBitsPerSecond: RecordingVideoBitsPerSecond,
      audioBitsPerSecond: RecordingAudioBitsPerSecond,
    });

    if (this.config.uploadMode === "streaming") {
      this.startStreamingMode();
    } else {
      this.startOnStopMode();
    }

    this.recording = true;
    this.emitState();

    if (this.config.maxDuration) {
      this.timer = setTimeout(() => this.stop(), this.config.maxDuration * 1000);
    }
  }

  stop(): void {
    if (!this.recording) return;
    if (this.recorder?.state === "recording") {
      this.recorder.stop();
    }
    this.recording = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.emitState();
  }

  dispose(): void {
    this.stop();
    this.removeStreamingListeners();
    this.recorder = null;
  }

  retry(): void {
    if (!this.recordedBlob) return;
    this.startOnStopUpload(this.recordedBlob, this.recordedMimeType);
  }

  saveToDevice(): void {
    if (this.config.uploadMode === "streaming" && this.chunks.length > 0) {
      const mimeType = this.recorder?.mimeType ?? "video/webm";
      const blob = new Blob(this.chunks, { type: mimeType });
      tusaSaveToDevice(blob, this.buildFileName());
    } else if (this.recordedBlob) {
      tusaSaveToDevice(this.recordedBlob, this.buildFileName());
    }
    this.uploadStatus = "complete";
    this.uploadProgress = 100;
    this.emitState();
    this.onUploadComplete?.("saved-locally");
  }

  getResponse(): Record<string, unknown> {
    return {
      uploadId: this.streamingUploadId || null,
      fileName: this.streamingFileName || this.buildFileName(),
      mimeType: this.recordedMimeType,
      frameRate: this.sourceFrameRate,
      duration: 0,
      uploadMode: this.config.uploadMode,
    };
  }

  // ── Private: On-Stop Mode ────────────────────────────

  private startOnStopMode(): void {
    if (!this.recorder) return;

    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.onstop = () => {
      const mimeType = this.recorder?.mimeType ?? "video/webm";
      const blob = new Blob(this.chunks, { type: mimeType });
      this.recordedBlob = blob;
      this.recordedMimeType = mimeType;
      this.startOnStopUpload(blob, mimeType);
    };
    this.recorder.start();
  }

  private startOnStopUpload(blob: Blob, mimeType: string): void {
    this.uploadStatus = "uploading";
    this.uploadProgress = 0;
    this.emitState();

    startUpload({
      blob,
      experimentId: this.config.experimentId,
      participantId: this.config.participantId,
      progress: this.config.progress,
      trial: this.config.trial,
      elementName: this.config.elementName,
      timestamp: this.recordingTimestamp,
      filename: this.buildFileName(),
      mimeType,
      frameRate: this.sourceFrameRate ?? undefined,
      onProgress: (pct) => {
        this.uploadProgress = pct;
        this.emitState();
      },
      onSuccess: (url) => {
        this.uploadStatus = "complete";
        this.uploadProgress = 100;
        this.emitState();
        this.onUploadComplete?.(url);
      },
      onError: () => {
        this.uploadStatus = "failed";
        this.emitState();
        this.onUploadFailed?.();
      },
    });
  }

  // ── Private: Streaming Mode ──────────────────────────

  private startStreamingMode(): void {
    if (!this.recorder) return;
    const socket = getSocket();
    if (!socket) return;

    this.uploadStatus = "uploading";
    this.uploadProgress = 0;
    this.streamingChunkIndex = 0;
    // A new recording is a new upload: wait for its own upload:ready.
    this.streamingUploadId = "";
    this.streamingFileName = "";

    socket.emit("upload:start", {
      experimentId: this.config.experimentId,
      participantId: this.config.participantId,
      progress: this.config.progress,
      trial: this.config.trial,
      elementName: this.config.elementName,
      timestamp: this.recordingTimestamp,
      mimeType: this.recorder.mimeType ?? "video/webm",
    });

    this.addStreamingListeners();

    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.chunks.push(e.data);
        this.sendStreamingChunk(e.data);
      }
    };
    this.recorder.onstop = () => {
      this.finishStreamingUpload();
    };
    this.recorder.start(StreamingChunkIntervalMs);
  }

  private sendStreamingChunk(data: Blob): void {
    const socket = getSocket();
    if (!socket || !this.streamingUploadId) return;

    data.arrayBuffer().then((buffer) => {
      socket.emit("upload:chunk", {
        uploadId: this.streamingUploadId,
        chunkIndex: this.streamingChunkIndex++,
        data: buffer,
      });
    });
  }

  private finishStreamingUpload(): void {
    const socket = getSocket();
    if (!socket || !this.streamingUploadId) return;
    socket.emit("upload:finish", { uploadId: this.streamingUploadId });
  }

  private addStreamingListeners(): void {
    const socket = getSocket();
    if (!socket) return;
    socket.on("upload:ready", this.handleUploadReady);
    socket.on("upload:chunk:ack", this.handleChunkAck);
    socket.on("upload:complete", this.handleUploadComplete);
    socket.on("upload:error", this.handleUploadError);
  }

  private removeStreamingListeners(): void {
    const socket = getSocket();
    if (!socket) return;
    socket.off("upload:ready", this.handleUploadReady);
    socket.off("upload:chunk:ack", this.handleChunkAck);
    socket.off("upload:complete", this.handleUploadComplete);
    socket.off("upload:error", this.handleUploadError);
  }

  private handleUploadReady = (payload: { uploadId: string; elementName?: string; fileName?: string; bytesReceived?: number; lastChunkIndex?: number }): void => {
    // Another recording on this socket (multi-capture records several) gets its own reply.
    const ours = this.streamingUploadId
      ? payload.uploadId === this.streamingUploadId
      : payload.elementName === this.config.elementName;
    if (!ours) return;
    this.streamingUploadId = payload.uploadId;
    if (payload.fileName) this.streamingFileName = payload.fileName;
    if (payload.bytesReceived) {
      this.uploadProgress = payload.bytesReceived;
    }
  };

  private handleChunkAck = (payload: { uploadId: string; chunkIndex: number; bytesReceived: number }): void => {
    if (payload.uploadId !== this.streamingUploadId) return;
    this.uploadProgress = payload.bytesReceived;
    this.emitState();
  };

  private handleUploadComplete = (payload: { uploadId: string; filePath: string }): void => {
    if (payload.uploadId !== this.streamingUploadId) return;
    this.uploadStatus = "complete";
    this.uploadProgress = 100;
    this.removeStreamingListeners();
    this.emitState();
    this.onUploadComplete?.(this.streamingUploadId);
  };

  private handleUploadError = (payload: { uploadId: string; message: string }): void => {
    if (payload.uploadId !== this.streamingUploadId) return;
    this.uploadStatus = "failed";
    this.removeStreamingListeners();
    this.emitState();
    this.onUploadFailed?.();
  };

  // ── Private: Helpers ─────────────────────────────────

  private buildFileName(): string {
    const ext = "webm";
    const fpsTag = this.sourceFrameRate ? `_${Math.round(this.sourceFrameRate)}fps` : "";
    return `p${this.config.progress}_t${this.config.trial}_${this.config.elementName}_${this.recordingTimestamp}${fpsTag}.${ext}`;
  }

  private emitState(): void {
    this.onStateChange?.({
      recording: this.recording,
      uploadStatus: this.uploadStatus,
      uploadProgress: this.uploadProgress,
    });
  }
}
