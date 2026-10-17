/**
 * sourceState — what an element's `src` actually is, for the Inspector field
 * and the canvas warning badge.
 *
 * The point of the four states is that a stored `asset:` reference is
 * verifiable while authoring: a dead external URL looks exactly like a live one
 * until a participant loads it, but a dead asset reference is knowable here.
 */

import type { AssetSummary } from "$lib/api";
import { isRef, parseRef, type ParsedRef } from "ame-shared/refs";
import { AssetRefPrefix } from "./assetSrc";

export type SourceState =
  | { kind: "empty" }
  | { kind: "asset"; asset: AssetSummary }
  | { kind: "reference"; ref: string; parsed: ParsedRef | null }
  | { kind: "missing"; assetId: string; fileName: string | null }
  | { kind: "external"; url: string };

/**
 * @param src the element's stored source.
 * @param assets the experiment's library, as listed by `listAssets`.
 */
export function describeSource(
  src: string | undefined,
  assets: AssetSummary[],
): SourceState {
  if (!src) return { kind: "empty" };

  // `isRef`'s predicate is `value is string`: called on the already-`string`
  // `src`, TypeScript would narrow it to `never` in the branches below (there
  // is no non-string subtype of string left to narrow to). The `as boolean`
  // discards the predicate and keeps this a plain boolean check.
  if (isRef(src) as boolean) return { kind: "reference", ref: src, parsed: parseRef(src) };

  if (!src.startsWith(AssetRefPrefix)) {
    return { kind: "external", url: src };
  }

  const assetId = src.slice(AssetRefPrefix.length);
  const asset = assets.find((candidate) => candidate.id === assetId);

  if (!asset || asset.missing) {
    return { kind: "missing", assetId, fileName: asset?.fileName ?? null };
  }

  return { kind: "asset", asset };
}
