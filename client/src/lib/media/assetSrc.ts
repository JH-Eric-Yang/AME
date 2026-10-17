/**
 * assetSrc — turning an element's stored `src` into a URL the browser can load.
 *
 * Element params store `asset:<id>` rather than a URL so that moving an
 * experiment between hosts, or exporting it, never bakes in a hostname.
 *
 * The prefix is redeclared here rather than imported from `ame-shared/assetUsage`
 * on purpose: client vitest resolves `ame-shared` for types only, so a value
 * import from it fails to load in a test.
 */

import { ServerUrl } from "$lib/config";

/**
 * Exported so its siblings in this directory — and the admin components that
 * mint references — share one declaration rather than hand-building the
 * literal. It is redeclared rather than re-exported from `ame-shared` for the
 * reason above.
 */
export const AssetRefPrefix = "asset:";

/**
 * Paths the API server owns. A resolved `ref:` media reference arrives from
 * the server as `/api/uploads/<id>?token=…` — relative, so no hostname is
 * baked into delivered content — and is the only kind of relative src that
 * belongs to the API origin. Any other relative path is the client's own.
 */
const ApiPathPrefix = "/api/";

/** The stored `src` for an asset id: the inverse of `resolveSrc`. */
export function assetRef(id: string): string {
  return `${AssetRefPrefix}${id}`;
}

/**
 * @param src an element's stored source: an `asset:` reference, an
 *            API-relative path (what a resolved `ref:` media reference
 *            arrives as — `/api/uploads/<id>?token=…`), a client-relative
 *            path, an external URL, or nothing at all.
 * @returns a loadable URL, or an empty string when there is nothing to load —
 *          which leaves the tag inert rather than requesting the current page.
 */
export function resolveSrc(src: string | undefined | null): string {
  if (!src) return "";
  if (src.startsWith(ApiPathPrefix)) return `${ServerUrl}${src}`;
  if (!src.startsWith(AssetRefPrefix)) return src;

  const id = src.slice(AssetRefPrefix.length);
  return id ? `${ServerUrl}/api/assets/${id}` : "";
}
