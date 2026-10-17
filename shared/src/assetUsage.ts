/**
 * assetUsage — reading and rewriting the `asset:<id>` references that element
 * params use to point at uploaded media.
 *
 * The admin UI reads usage to show "used 3x" and to warn before a delete; the
 * server rewrites references on import, where every asset is given a fresh id.
 */

import type { RoutineConfig } from "./types.js";

/** Marks a src as pointing at an uploaded asset rather than an external URL. */
export const AssetRefPrefix = "asset:";

/**
 * One row of an experiment export's asset manifest — metadata only, never the
 * bytes. `exportJson` writes these; `importJson` reads them back to mint
 * fresh ids and remap every `asset:<id>` reference to match.
 */
export interface AssetManifestEntry {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
}

/**
 * One place an asset is referenced.
 *
 * The two sources are kept distinguishable because they are repaired
 * differently: an element is fixed in the Builder's Inspector, a content row in
 * the Content tab or by re-running the Session Designer block that stamped it.
 */
export type AssetUse =
  | { source: "element"; routine: string; element: string }
  | { source: "content"; routine: string; progress: number; trialNumber: number };

/**
 * One content row, as `listContent` returns it. Only the fields usage analysis
 * needs — `content` is experiment-defined JSON and is walked, not typed.
 */
export interface ContentRowRef {
  progress: number;
  trialNumber: number;
  routine: string;
  content: unknown;
}

/** A short human label for one usage, for the "used by …" delete warning. */
export function describeAssetUse(use: AssetUse): string {
  return use.source === "element"
    ? `${use.routine}/${use.element}`
    : `${use.routine} content (progress ${use.progress}, trial ${use.trialNumber})`;
}

export function isAssetRef(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(AssetRefPrefix);
}

export function assetIdFromRef(ref: string): string {
  return ref.slice(AssetRefPrefix.length);
}

/** Every distinct asset id reachable anywhere inside a content row's JSON. */
function collectAssetRefs(value: unknown, found: Set<string>): void {
  if (isAssetRef(value)) {
    found.add(assetIdFromRef(value));
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) collectAssetRefs(entry, found);
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) collectAssetRefs(entry, found);
  }
}

/**
 * Everything referencing each asset, keyed by asset id: elements first in
 * routine order, then content rows in the order given. Assets nothing
 * references are simply absent from the map.
 *
 * Content rows matter as much as elements here. `compileSessionDesign` writes
 * `design.trialContent[trialNumber]` straight into `ExperimentContent.content`,
 * and that is researcher-authored — a per-trial stimulus reference lives there
 * and nowhere else, so walking routines alone would report a researcher's own
 * trial stimuli as unused and delete them behind a bland confirmation.
 *
 * A row's `content` is experiment-defined JSON, so it is walked in full rather
 * than read at a fixed key, the same way `remapAssetRefs` rewrites it. One row
 * referencing the same asset twice counts once: it is one place to repair.
 *
 * `contents` is required rather than defaulted, so a caller with no rows to
 * hand says so explicitly instead of silently re-acquiring the gap this
 * parameter closes.
 */
export function findAssetUsage(
  routines: RoutineConfig[],
  contents: ContentRowRef[],
): Map<string, AssetUse[]> {
  const usage = new Map<string, AssetUse[]>();

  const record = (id: string, use: AssetUse): void => {
    const uses = usage.get(id) ?? [];
    uses.push(use);
    usage.set(id, uses);
  };

  for (const routine of routines) {
    for (const element of routine.elements) {
      const src = (element.params as { src?: unknown }).src;
      if (!isAssetRef(src)) continue;

      record(assetIdFromRef(src), {
        source: "element",
        routine: routine.name,
        element: element.name,
      });
    }
  }

  for (const row of contents) {
    const found = new Set<string>();
    collectAssetRefs(row.content, found);

    for (const id of found) {
      record(id, {
        source: "content",
        routine: row.routine,
        progress: row.progress,
        trialNumber: row.trialNumber,
      });
    }
  }

  return usage;
}

/**
 * A deep copy of `value` with every `asset:<old>` rewritten to `asset:<new>`.
 *
 * Walks arbitrary JSON rather than only element params, because content rows
 * carry references too and their shape is experiment-defined. A reference with
 * no entry in the map is left alone.
 */
export function remapAssetRefs<T>(value: T, idMap: Map<string, string>): T {
  if (isAssetRef(value)) {
    const mapped = idMap.get(assetIdFromRef(value));
    return (mapped ? `${AssetRefPrefix}${mapped}` : value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => remapAssetRefs(entry, idMap)) as T;
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, remapAssetRefs(entry, idMap)]),
    ) as T;
  }

  return value;
}
