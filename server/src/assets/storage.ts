/**
 * storage — where an experiment's stimulus media lives on disk.
 *
 * A sibling of `uploads/`, never inside it: `uploads/` holds participant
 * recordings and is reachable only through the authenticated ZIP export, while
 * everything here is served by a public endpoint.
 */

import { unlink } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const Dirname = path.dirname(fileURLToPath(import.meta.url));

/** Root directory holding every uploaded stimulus. Outside nodemon's src watch. */
export const AssetDir = path.resolve(Dirname, "../../assets");

/** Largest single upload accepted, in bytes. */
export const MaxAssetBytes = 500 * 1024 * 1024;

/** Mimetype prefixes an element can present. */
const AllowedTypePrefixes = ["image/", "video/", "audio/"];

/**
 * A well-formed `type/subtype`. Nothing else may reach `res.setHeader`: tus
 * metadata is arbitrary base64-decoded UTF-8 (`@tus/utils` validates the
 * base64 shape, not its content), so without this `image/png\r\nX: y` passes
 * the prefix check, is stored, and makes Node's `validateHeaderValue` throw on
 * the next anonymous GET — after an await, where Express 4 can no longer catch
 * it. That is an unhandled rejection, which by default takes the process down
 * and every participant's socket with it.
 */
const MimeTypePattern = /^[\w.+-]+\/[\w.+-]+$/;

/**
 * Where FileStore writes an asset. Flat, keyed by the asset id, because that id
 * is also the tus id and appears in the public URL — nesting per experiment
 * would make it a two-segment path.
 */
export function assetFilePath(assetId: string): string {
  return path.join(AssetDir, assetId);
}

/** Whether this mimetype is stimulus media an element can render. */
export function isAllowedAssetType(mimeType: string): boolean {
  return (
    MimeTypePattern.test(mimeType) &&
    AllowedTypePrefixes.some((prefix) => mimeType.startsWith(prefix))
  );
}

/**
 * Remove an asset's bytes and the metadata sidecar `@tus/file-store` writes
 * beside them.
 *
 * FileStore's key-value store resolves a key to `<filePath>.json`, so every
 * finished upload leaves two files while `Asset.filePath` names only one.
 * Unlinking just the payload orphans the sidecar for the life of the disk.
 * Both are best-effort: a file already gone is not an error, and the row is
 * dropped either way.
 */
export async function unlinkAssetFile(filePath: string): Promise<void> {
  await Promise.all([
    unlink(filePath).catch(() => undefined),
    unlink(`${filePath}.json`).catch(() => undefined),
  ]);
}
