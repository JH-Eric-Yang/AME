import { Router } from "express";
import { Server as TusServer } from "@tus/server";
import { FileStore } from "@tus/file-store";
import { randomUUID } from "crypto";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { AssetDir, MaxAssetBytes } from "../assets/storage.js";
import { experimenterFromAuthHeader } from "../assets/assetAuth.js";
import { recordAssetStarted, recordAssetFinished } from "../assets/assetHooks.js";
import * as assets from "../controllers/assets.js";

/** Only a client-supplied id shaped like a uuid v4 may name an upload's file. */
const Uuid4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The filesystem name @tus/file-store gives a new upload, which it turns into
 * `path.join(AssetDir, id)` with no guard of its own. A restore's tus client
 * sends the existing Asset row's id as `metadata.assetId` so the finished file
 * lands at the path that row already points at; `recordAssetStarted` (in
 * `onUploadCreate`, below) separately rejects any `assetId` that is not
 * already a real row in an experiment the caller owns, before a byte is
 * written. Restricting this to a uuid v4 SHAPE closes the same door from the
 * naming side too, independent of that DB check — a future `@tus/server`
 * upgrade that reorders its handler pipeline, or a later relaxation of the
 * restore check, should not turn a crafted `assetId` like
 * `"../../uploads/x"` into a write outside `AssetDir`.
 */
export function resolveAssetUploadId(metadata: Record<string, string | null> | undefined): string {
  const assetId = metadata?.assetId;
  return assetId && Uuid4Pattern.test(assetId) ? assetId : randomUUID();
}

/**
 * The tus path must be a fixed string — tus builds each upload's Location
 * header from it — so the experiment travels in the metadata rather than in the
 * URL, exactly as the participant upload route does.
 */
const tusServer = new TusServer({
  path: "/api/admin/assets/upload",
  datastore: new FileStore({ directory: AssetDir }),
  maxSize: MaxAssetBytes,
  namingFunction: (_req, metadata) => resolveAssetUploadId(metadata),
  onUploadCreate: (req, upload) =>
    recordAssetStarted(upload, experimenterFromAuthHeader(req.headers.get("authorization"))),
  onUploadFinish: (_req, upload) => recordAssetFinished(upload),
});

export const adminAssetRoutes = Router();

// requireAuth is attached per route, NOT via `adminAssetRoutes.use(...)`. This
// router mounts at /api/admin, and router-level middleware runs on every
// request matching the mount path whether or not a route here matches — so a
// `use` would reject `POST /api/admin/login` and `/signup`, which must stay
// unauthenticated.
adminAssetRoutes.all("/assets/upload*", requireAuth, (req, res) => {
  tusServer.handle(req, res);
});
adminAssetRoutes.get("/experiments/:id/assets", requireAuth, asyncHandler(assets.listAssets));
adminAssetRoutes.delete("/assets/:assetId", requireAuth, asyncHandler(assets.deleteAsset));

export const publicAssetRoutes = Router();

publicAssetRoutes.get("/:assetId", asyncHandler(assets.serveAsset));
