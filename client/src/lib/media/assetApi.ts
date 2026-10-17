/**
 * assetApi — uploading stimulus media from the admin dashboard.
 *
 * Reuses the participant upload's tus client: stimulus videos are large and lab
 * connections drop, so resumability is worth as much here as it is there. The
 * difference is the endpoint and the bearer token.
 */

import type { Upload } from "tus-js-client";
import { startUpload } from "$lib/upload/tusClient";
import { auth } from "$lib/stores/auth";

export interface UploadAssetOptions {
  file: File;
  experimentId: string;
  /** Set to refill a row whose file is missing, instead of creating a new one. */
  assetId?: string;
  onProgress?: (pct: number) => void;
  onSuccess?: () => void;
  onError?: (err: Error) => void;
}

export function uploadAsset(opts: UploadAssetOptions): Upload {
  const token = auth.getToken();

  return startUpload({
    blob: opts.file,
    endpointPath: "/api/admin/assets/upload",
    experimentId: opts.experimentId,
    filename: opts.file.name,
    mimeType: opts.file.type || "application/octet-stream",
    ...(opts.assetId ? { assetId: opts.assetId } : {}),
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    onProgress: opts.onProgress,
    onSuccess: () => opts.onSuccess?.(),
    onError: opts.onError,
  });
}
