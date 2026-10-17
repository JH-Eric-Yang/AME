/**
 * tusHooks — the database side of a tus upload, kept out of the route so the
 * Upload row's lifecycle can be tested without standing up a tus server.
 */

import prisma from "../prisma.js";
import { tusFilePath } from "./storage.js";

/** The subset of @tus/server's upload object these hooks read. */
export interface TusUploadInfo {
  id: string;
  size?: number;
  offset?: number;
  metadata?: Record<string, string | null> | undefined;
}

/** Rejection shape @tus/server turns into an HTTP response. */
const MissingMetadataError = {
  status_code: 400,
  body: "Missing experimentId or participantId metadata",
};

/** Create the Upload row for an upload that has just been announced. */
export async function recordUploadStarted(upload: TusUploadInfo): Promise<Record<string, never>> {
  const meta = upload.metadata;
  if (!meta?.experimentId || !meta?.participantId) {
    throw MissingMetadataError;
  }

  await prisma.upload.create({
    data: {
      id: upload.id,
      experimentId: meta.experimentId,
      participantId: meta.participantId,
      progress: parseInt(meta.progress ?? "0", 10),
      trial: parseInt(meta.trial ?? "1", 10),
      elementName: meta.elementName ?? "unknown",
      timestamp: meta.timestamp ? new Date(meta.timestamp) : new Date(),
      fileName: meta.filename ?? "recording.webm",
      mimeType: meta.mimeType ?? "video/webm",
      totalSize: BigInt(upload.size ?? 0),
      status: "UPLOADING",
    },
  });

  return {};
}

/**
 * Mark the upload complete and record where FileStore put it. Without the path
 * the file is on disk but invisible to `GET /export/files`.
 */
export async function recordUploadFinished(upload: TusUploadInfo): Promise<Record<string, never>> {
  await prisma.upload.update({
    where: { id: upload.id },
    data: {
      status: "COMPLETE",
      totalSize: BigInt(upload.offset ?? 0),
      filePath: tusFilePath(upload.id),
    },
  });

  return {};
}
