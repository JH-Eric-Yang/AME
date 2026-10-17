/**
 * tusClient — wraps tus-js-client for resumable chunked uploads.
 */

import { Upload } from "tus-js-client";

import { ServerUrl as ApiOrigin } from "$lib/config";

const ChunkSizeBytes = 1024 * 1024; // 1MB

export interface UploadOptions {
  blob: Blob;
  experimentId: string;
  participantId?: string;
  progress?: number;
  trial?: number;
  elementName?: string;
  timestamp?: string;
  filename?: string;
  mimeType?: string;
  frameRate?: number;
  /** Server path handling this upload. Defaults to the participant endpoint. */
  endpointPath?: string;
  /** Existing asset row to refill, for an admin restore. */
  assetId?: string;
  /** Extra request headers, e.g. an admin Authorization bearer token. */
  headers?: Record<string, string>;
  onProgress?: (percentage: number) => void;
  onSuccess?: (url: string) => void;
  onError?: (err: Error) => void;
}

export function startUpload(opts: UploadOptions): Upload {
  const upload = new Upload(opts.blob, {
    endpoint: `${ApiOrigin}${opts.endpointPath ?? "/api/upload"}`,
    retryDelays: [0, 1000, 3000, 5000],
    chunkSize: ChunkSizeBytes,
    ...(opts.headers ? { headers: opts.headers } : {}),
    metadata: {
      experimentId: opts.experimentId,
      ...(opts.participantId ? { participantId: opts.participantId } : {}),
      filename: opts.filename ?? "recording.webm",
      mimeType: opts.mimeType ?? "video/webm",
      ...(opts.progress != null ? { progress: String(opts.progress) } : {}),
      ...(opts.trial != null ? { trial: String(opts.trial) } : {}),
      ...(opts.elementName ? { elementName: opts.elementName } : {}),
      ...(opts.timestamp ? { timestamp: opts.timestamp } : {}),
      ...(opts.frameRate != null ? { frameRate: String(opts.frameRate) } : {}),
      ...(opts.assetId ? { assetId: opts.assetId } : {}),
    },
    onProgress: (bytesUploaded, bytesTotal) => {
      const pct = Math.round((bytesUploaded / bytesTotal) * 100);
      opts.onProgress?.(pct);
    },
    onSuccess: () => {
      opts.onSuccess?.(upload.url ?? "");
    },
    onError: (err) => {
      opts.onError?.(err);
    },
  });

  upload.start();
  return upload;
}

/**
 * Fallback: save blob to disk via browser download API.
 */
export function saveToDevice(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
