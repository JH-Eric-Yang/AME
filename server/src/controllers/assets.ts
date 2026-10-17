import type { Response } from "express";
import path from "path";
import prisma from "../prisma.js";
import { experimenterOwnsExperiment } from "../experimentAccess.js";
import { AssetDir, isAllowedAssetType, unlinkAssetFile } from "../assets/storage.js";
import type { AuthRequest } from "../middleware/auth.js";

/** Everything outside this set is stripped from a filename before it goes in a header. */
const SafeFileNameChars = /[^A-Za-z0-9._ -]/g;

/**
 * A `Content-Disposition`-safe rendering of a researcher-supplied filename, or
 * `undefined` when nothing safe survives. `fileName` travels inside a quoted
 * header value; an unescaped `"` would let a filename close the quote early
 * and inject header syntax, and Node throws on a raw CR/LF in a header value
 * rather than letting it inject a header — either way, the row must never
 * reach `setHeader` unsanitised.
 */
function sanitizeFileName(fileName: string): string | undefined {
  const stripped = fileName.replace(SafeFileNameChars, "").trim();
  return stripped.length > 0 ? stripped : undefined;
}

/**
 * Whether this asset's file lives inside `AssetDir`. Belt to
 * `resolveAssetUploadId`'s braces (`routes/assets.ts`): even if a bad path
 * somehow reached the `filePath` column — a crafted import, a manual DB edit —
 * this is what stops the public endpoint from ever serving `server/uploads/`,
 * which holds participant recordings.
 */
function isInsideAssetDir(filePath: string): boolean {
  const resolvedDir = path.resolve(AssetDir) + path.sep;
  return path.resolve(filePath).startsWith(resolvedDir);
}

/** One asset as the admin UI sees it. `size` is a number: JSON cannot hold BigInt. */
export interface AssetSummary {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  missing: boolean;
  createdAt: string;
}

export async function listAssets(req: AuthRequest, res: Response): Promise<void> {
  const experimentId = req.params.id;

  if (!(await experimenterOwnsExperiment(req.auth!.experimenterId, experimentId))) {
    res.status(404).json({ code: "NOT_FOUND", message: "Experiment not found" });
    return;
  }

  const rows = await prisma.asset.findMany({
    where: { experimentId },
    orderBy: { createdAt: "asc" },
  });

  const assets: AssetSummary[] = rows.map((row) => ({
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    size: Number(row.size),
    missing: row.filePath === null,
    createdAt: row.createdAt.toISOString(),
  }));

  res.json({ assets });
}

export async function deleteAsset(req: AuthRequest, res: Response): Promise<void> {
  const asset = await prisma.asset.findUnique({ where: { id: req.params.assetId } });

  if (
    !asset ||
    !(await experimenterOwnsExperiment(req.auth!.experimenterId, asset.experimentId))
  ) {
    res.status(404).json({ code: "NOT_FOUND", message: "Asset not found" });
    return;
  }

  // The row goes either way; a file that is already gone is not an error.
  // The containment check is the same one `serveAsset` applies: a filePath
  // that somehow points outside AssetDir must not be unlinked either, or a
  // crafted row would turn a delete into an arbitrary file removal.
  if (asset.filePath && isInsideAssetDir(asset.filePath)) {
    await unlinkAssetFile(asset.filePath);
  }

  await prisma.asset.delete({ where: { id: asset.id } });
  res.status(204).end();
}

/**
 * Serve a stimulus. Deliberately unauthenticated: participants hold no JWT and
 * an <img> or <video> tag cannot attach one. Ids are uuid v4, so a URL is
 * unguessable. This serves `server/assets/` ONLY — never `server/uploads/`,
 * which holds participant recordings.
 */
export async function serveAsset(req: AuthRequest, res: Response): Promise<void> {
  const asset = await prisma.asset.findUnique({ where: { id: req.params.assetId } });

  if (!asset) {
    res.status(404).json({ code: "NOT_FOUND", message: "Asset not found" });
    return;
  }

  const missing = (): void => {
    // res.json only sets Content-Type when none is set yet, and the sendFile
    // branch below sets one for the stimulus before it can know the file is
    // actually readable — so this must force JSON's content type back over
    // that, or a late ENOENT would ship a JSON body mislabelled e.g. image/png.
    res.status(404).type("application/json").json({
      code: "ASSET_MISSING",
      message: `${asset.fileName} has not been uploaded yet`,
    });
  };

  if (!asset.filePath) {
    missing();
    return;
  }

  if (!isInsideAssetDir(asset.filePath)) {
    // A distinct code, because this is not "not uploaded yet" — the bytes may
    // well exist. It means the row points somewhere it must never be served
    // from, which is an operator's problem, not a researcher's.
    res.status(404).type("application/json").json({
      code: "ASSET_OUTSIDE_DIR",
      message: `${asset.fileName} is not stored in the asset directory`,
    });
    return;
  }

  // The mimetype allowlist (`isAllowedAssetType`) admits any `image/` subtype,
  // so `image/svg+xml` is accepted — and an SVG can carry a <script> that runs
  // when this response is opened directly. nosniff stops a browser from
  // reinterpreting the body as something else; the CSP blocks any script the
  // body contains from executing while still letting the SVG render inside an
  // <img>; Content-Disposition: inline (rather than attachment) keeps every
  // other media type rendering in place, same as before.
  //
  // The stored mimetype is re-checked rather than trusted, because the row need
  // not have passed today's upload validation: rows predate the allowlist's
  // shape check, and an import writes rows this process never saw uploaded. A
  // malformed value here throws ERR_INVALID_CHAR inside setHeader, after an
  // await — Express 4's try/catch has already returned, so it surfaces as an
  // unhandled rejection that ends the process and drops every participant's
  // socket.
  res.type(isAllowedAssetType(asset.mimeType) ? asset.mimeType : "application/octet-stream");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  const safeFileName = sanitizeFileName(asset.fileName);
  res.setHeader(
    "Content-Disposition",
    safeFileName ? `inline; filename="${safeFileName}"` : "inline",
  );

  // sendFile answers Range requests with 206, which <video> needs in order to
  // seek. Its own error path (a file gone from disk since the row was read —
  // a concurrent delete, a half-restored import) calls back rather than
  // throwing, so without this callback it falls through to Express's default
  // error handler instead of the JSON 404 every other branch here returns.
  // sendFile has already started streaming a successful response by the time
  // it could error, so guard against writing a second response onto one
  // whose headers already went out.
  res.sendFile(asset.filePath, (err) => {
    if (err && !res.headersSent) {
      missing();
    }
  });
}
