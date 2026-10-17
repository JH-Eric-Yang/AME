import { createWriteStream, mkdirSync } from "fs";
import type { WriteStream } from "fs";
import path from "path";
import type { Namespace } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "ame-shared";
import { randomUUID } from "crypto";
import prisma from "../prisma.js";
import { UploadDir } from "../uploads/storage.js";
import type { TypedSocket, SocketState } from "./index.js";
import { safeOn, safeOnDisconnect } from "./safeListener.js";

type TypedNamespace = Namespace<ClientToServerEvents, ServerToClientEvents>;

interface ActiveUpload {
  id: string;
  socketId: string;
  stream: WriteStream;
  filePath: string;
  bytesReceived: number;
  lastChunkIndex: number;
}

/**
 * Module-level map of active streaming uploads, keyed by uploadId, shared by
 * every socket. Each entry records the socketId that owns it so a
 * disconnect only ends that socket's own uploads — never another
 * participant's in-flight recording.
 */
const ActiveUploads = new Map<string, ActiveUpload>();

function buildFilePath(
  experimentId: string,
  participantId: string,
  progress: number,
  trial: number,
  elementName: string,
  timestamp: string,
  mimeType: string,
): string {
  const ext = mimeType.includes("audio") ? "webm" : "webm";
  const fileName = `p${progress}_t${trial}_${elementName}_${timestamp}.${ext}`;
  return path.join(UploadDir, experimentId, participantId, fileName);
}

export function registerUploadHandler(
  ns: TypedNamespace,
  socket: TypedSocket,
): void {
  safeOn(socket, "upload:start", async (payload) => {
    const state = socket.data as SocketState;
    if (!state.experimentId || !state.participantId) {
      return;
    }

    try {
      const uploadId = randomUUID();
      const filePath = buildFilePath(
        payload.experimentId,
        payload.participantId,
        payload.progress,
        payload.trial,
        payload.elementName,
        payload.timestamp,
        payload.mimeType,
      );

      // Ensure directory exists
      const dir = path.dirname(filePath);
      mkdirSync(dir, { recursive: true });

      // Create write stream
      const stream = createWriteStream(filePath, { flags: "w" });

      // Create DB record
      await prisma.upload.create({
        data: {
          id: uploadId,
          experimentId: payload.experimentId,
          participantId: payload.participantId,
          progress: payload.progress,
          trial: payload.trial,
          elementName: payload.elementName,
          timestamp: new Date(payload.timestamp),
          fileName: path.basename(filePath),
          mimeType: payload.mimeType,
          status: "UPLOADING",
        },
      });

      // Track active upload
      ActiveUploads.set(uploadId, {
        id: uploadId,
        socketId: socket.id,
        stream,
        filePath,
        bytesReceived: 0,
        lastChunkIndex: -1,
      });

      socket.emit("upload:ready", { uploadId, elementName: payload.elementName, fileName: path.basename(filePath) });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to start upload";
      socket.emit("upload:error", { uploadId: "", message });
    }
  });

  safeOn(socket, "upload:chunk", (payload) => {
    const active = ActiveUploads.get(payload.uploadId);
    if (!active) {
      socket.emit("upload:error", {
        uploadId: payload.uploadId,
        message: "Unknown upload ID",
      });
      return;
    }

    // Check chunk ordering
    if (payload.chunkIndex <= active.lastChunkIndex) {
      // Duplicate chunk — ack with current state
      socket.emit("upload:chunk:ack", {
        uploadId: payload.uploadId,
        chunkIndex: active.lastChunkIndex,
        bytesReceived: active.bytesReceived,
      });
      return;
    }

    const buffer = Buffer.from(payload.data);
    active.stream.write(buffer, () => {
      active.bytesReceived += buffer.length;
      active.lastChunkIndex = payload.chunkIndex;

      socket.emit("upload:chunk:ack", {
        uploadId: payload.uploadId,
        chunkIndex: payload.chunkIndex,
        bytesReceived: active.bytesReceived,
      });
    });
  });

  safeOn(socket, "upload:finish", async (payload) => {
    const active = ActiveUploads.get(payload.uploadId);
    if (!active) {
      socket.emit("upload:error", {
        uploadId: payload.uploadId,
        message: "Unknown upload ID",
      });
      return;
    }

    // Close the write stream
    active.stream.end(async () => {
      try {
        await prisma.upload.update({
          where: { id: payload.uploadId },
          data: {
            status: "COMPLETE",
            totalSize: BigInt(active.bytesReceived),
            filePath: active.filePath,
          },
        });

        socket.emit("upload:complete", {
          uploadId: payload.uploadId,
          filePath: active.filePath,
        });
      } catch (err) {
        socket.emit("upload:error", {
          uploadId: payload.uploadId,
          message: "Failed to finalize upload",
        });
      } finally {
        ActiveUploads.delete(payload.uploadId);
      }
    });
  });

  safeOn(socket, "upload:resume", async (payload) => {
    const active = ActiveUploads.get(payload.uploadId);
    if (active) {
      // Upload still in-memory — return current state
      socket.emit("upload:ready", {
        uploadId: payload.uploadId,
        bytesReceived: active.bytesReceived,
        lastChunkIndex: active.lastChunkIndex,
      });
      return;
    }

    // Check DB for partial upload
    try {
      const upload = await prisma.upload.findUnique({
        where: { id: payload.uploadId },
      });

      if (!upload || upload.status !== "UPLOADING") {
        socket.emit("upload:error", {
          uploadId: payload.uploadId,
          message: "Upload not found or already complete",
        });
        return;
      }

      // Reopen write stream in append mode
      if (upload.filePath) {
        const stream = createWriteStream(upload.filePath, { flags: "a" });
        const bytesReceived = Number(upload.totalSize);
        const resumed: ActiveUpload = {
          id: payload.uploadId,
          socketId: socket.id,
          stream,
          filePath: upload.filePath,
          bytesReceived,
          lastChunkIndex: -1,
        };
        ActiveUploads.set(payload.uploadId, resumed);

        socket.emit("upload:ready", {
          uploadId: payload.uploadId,
          bytesReceived,
          lastChunkIndex: -1,
        });
      }
    } catch {
      socket.emit("upload:error", {
        uploadId: payload.uploadId,
        message: "Failed to resume upload",
      });
    }
  });

  // Clean up on disconnect — keep partial files, just close streams.
  // Recordings are always streamed from the desktop socket (RecordingManager
  // runs in ElRecorder/ElMultiCapture, both desktop-only); a device socket
  // never owns an entry in ActiveUploads. Skip the sweep for one, so a phone
  // disconnecting can never be the trigger that closes the desktop's in-flight
  // recording stream.
  //
  // ActiveUploads is shared by every socket, so only end/remove the entries
  // this socket owns — otherwise one participant closing their tab would
  // truncate every other participant's in-flight recording too.
  safeOnDisconnect(socket, () => {
    const state = socket.data as SocketState;
    if (state.deviceMode) return;

    for (const [uploadId, active] of ActiveUploads.entries()) {
      if (active.socketId !== socket.id) continue;

      active.stream.end(async () => {
        try {
          await prisma.upload.update({
            where: { id: uploadId },
            data: { totalSize: BigInt(active.bytesReceived) },
          });
        } catch {
          // Best-effort save
        }
      });
      ActiveUploads.delete(uploadId);
    }
  });
}
