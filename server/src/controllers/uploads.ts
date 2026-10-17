import type { Request, Response } from "express";
import path from "path";
import prisma from "../prisma.js";
import { UploadDir } from "../uploads/storage.js";
import { verifyMediaToken } from "../references/mediaToken.js";

/**
 * `type/subtype` plus whatever `;`-separated parameters MediaRecorder tacked
 * on (e.g. `video/webm;codecs=vp8,opus`) — those parameters are exactly what
 * `recordUploadStarted` stores verbatim on `Upload.mimeType`, so rejecting
 * them meant every real recording fell back to `application/octet-stream`.
 * Still excludes CR, LF, control and non-ASCII characters: a malformed value
 * throws `ERR_INVALID_CHAR` inside `setHeader`, after an `await`, so it
 * surfaces as an unhandled rejection that ends the process and drops every
 * participant's socket — the same header-injection rationale
 * `isAllowedAssetType` documents in `assets/storage.ts`.
 */
const MimeTypePattern = /^[\w.+-]+\/[\w.+-]+(?:;[ \w.+=,"/-]*)*$/;

/** Whether this upload's file lives inside `UploadDir`. Stops a crafted row from serving any path. */
function isInsideUploadDir(filePath: string): boolean {
  const resolvedDir = path.resolve(UploadDir) + path.sep;
  return path.resolve(filePath).startsWith(resolvedDir);
}

/**
 * Serve a participant upload to a participant holding a media token. The
 * token was minted when a `ref:` resolved to this upload, so possession is
 * the authorisation; no session lookup happens here.
 */
export async function serveUpload(req: Request, res: Response): Promise<void> {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const grantedId = token ? verifyMediaToken(token) : null;

  if (!grantedId || grantedId !== req.params.uploadId) {
    res.status(401).json({ code: "UNAUTHORIZED", message: "Missing, expired or mismatched media token" });
    return;
  }

  const upload = await prisma.upload.findUnique({ where: { id: grantedId } });
  if (!upload) {
    res.status(404).json({ code: "NOT_FOUND", message: "Upload not found" });
    return;
  }

  // Forced JSON type on every late 404: `res.type` below is set before
  // sendFile can learn the file is unreadable, and res.json would keep it.
  const notReady = (): void => {
    res.status(404).type("application/json").json({
      code: "UPLOAD_NOT_READY",
      message: `${upload.fileName} has not finished uploading`,
    });
  };

  if (upload.status !== "COMPLETE" || !upload.filePath) {
    notReady();
    return;
  }

  if (!isInsideUploadDir(upload.filePath)) {
    res.status(404).type("application/json").json({
      code: "UPLOAD_OUTSIDE_DIR",
      message: `${upload.fileName} is not stored in the upload directory`,
    });
    return;
  }

  res.type(MimeTypePattern.test(upload.mimeType) ? upload.mimeType : "application/octet-stream");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Content-Disposition", "inline");

  // sendFile answers Range requests with 206, which <video> needs to seek.
  res.sendFile(upload.filePath, (err) => {
    if (err && !res.headersSent) notReady();
  });
}
