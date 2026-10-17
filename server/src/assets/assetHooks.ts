/**
 * assetHooks — the database side of a stimulus upload, kept out of the route so
 * the Asset row's lifecycle can be tested without standing up a tus server.
 *
 * Mirrors `uploads/tusHooks.ts`, which does the same job for participant
 * recordings.
 */

import prisma from "../prisma.js";
import { experimenterOwnsExperiment } from "../experimentAccess.js";
import { assetFilePath, isAllowedAssetType } from "./storage.js";

/** The subset of @tus/server's upload object these hooks read. */
export interface TusUploadInfo {
  id: string;
  size?: number;
  offset?: number;
  metadata?: Record<string, string | null> | undefined;
}

/** Rejection shape @tus/server turns into an HTTP response. */
function reject(status_code: number, body: string) {
  return { status_code, body };
}

/**
 * Validate an announced upload and make sure a row exists for it.
 *
 * An `assetId` in the metadata means this is a restore of a file that arrived
 * without its bytes (an imported experiment), so the row already exists and
 * must not be duplicated.
 */
export async function recordAssetStarted(
  upload: TusUploadInfo,
  experimenterId: string,
): Promise<Record<string, never>> {
  const meta = upload.metadata;
  const experimentId = meta?.experimentId;

  if (!experimentId) {
    throw reject(400, "Missing experimentId metadata");
  }

  if (!(await experimenterOwnsExperiment(experimenterId, experimentId))) {
    throw reject(403, "Experiment not found");
  }

  const mimeType = meta?.mimeType ?? "";
  if (!isAllowedAssetType(mimeType)) {
    throw reject(415, `Unsupported media type: ${mimeType || "unknown"}`);
  }

  if (meta?.assetId) {
    const existing = await prisma.asset.findFirst({
      where: { id: meta.assetId, experimentId },
      select: { id: true },
    });
    if (!existing) {
      throw reject(404, "Asset not found in this experiment");
    }
    return {};
  }

  await prisma.asset.create({
    data: {
      id: upload.id,
      experimentId,
      fileName: meta?.filename ?? "asset",
      mimeType,
      size: BigInt(upload.size ?? 0),
    },
  });

  return {};
}

/**
 * Record where FileStore put the finished file. Without the path the file is on
 * disk but invisible to `GET /api/assets/:assetId`.
 */
export async function recordAssetFinished(
  upload: TusUploadInfo,
): Promise<Record<string, never>> {
  await prisma.asset.update({
    where: { id: upload.id },
    data: {
      filePath: assetFilePath(upload.id),
      size: BigInt(upload.offset ?? 0),
      mimeType: upload.metadata?.mimeType ?? "application/octet-stream",
    },
  });

  return {};
}
