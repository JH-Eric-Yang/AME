/**
 * Pure helpers for the Session Designer container. The container `.svelte`
 * cannot be unit-tested (the client suite has no jsdom), so every decision it
 * makes lives here.
 */

import type { RoutineConfig } from "ame-shared";
import type { SessionDesign } from "ame-shared/sessionDesign";
import { compileSessionDesign, diffCompiled } from "ame-shared/sessionDesign";
import { GeneratedDescriptionPrefix } from "ame-shared/contentValidation";
import type { ApplyState } from "./applyBarView";

/** Progress numbering starts at 1, so "no content yet" is progress 0. */
const NoContentProgress = 0;

/** Separator between the block id and the row index in a generated description. */
const BlockDescriptionSeparator = ":";

/** Not found, as `Array.prototype.findIndex` reports it. */
const NotFound = -1;

/**
 * Create-or-replace by name, returning a NEW array — the block owns all three
 * of its routines, so a rebuild overwrites them in place and appends only the
 * ones the Builder does not hold yet.
 *
 * Pure so the apply path can build the snapshot it is about to PUT WITHOUT
 * touching the store. That ordering matters: the apply bar reads its `+` / `~`
 * verb back off the Builder's routines, so adopting them before the server has
 * accepted them would make the plan claim to rewrite routines that do not exist
 * anywhere but locally.
 */
export function upsertByName(existing: RoutineConfig[], incoming: RoutineConfig[]): RoutineConfig[] {
  const next = [...existing];
  for (const routine of incoming) {
    const index = next.findIndex((r) => r.name === routine.name);
    if (index === NotFound) next.push(routine);
    else next[index] = routine;
  }
  return next;
}

/**
 * Highest `progress` in the experiment's content rows, or 0 when there are
 * none. A new block starts at `lastProgressOf(rows) + 1` so it never lands on
 * top of existing rows.
 */
export function lastProgressOf(rows: Record<string, unknown>[]): number {
  return rows.reduce((highest, row) => {
    const progress = typeof row.progress === "number" ? row.progress : NoContentProgress;
    return progress > highest ? progress : highest;
  }, NoContentProgress);
}

/**
 * The block ids that already own content rows on the server, read off a content
 * listing. `compileSessionDesign` stamps every row it emits
 * `block:<blockId>:<row index>`, and `replaceContent` deletes a band by that
 * same marker, so a row carrying the id is proof the band was written.
 */
export function blockIdsWithRows(rows: Record<string, unknown>[]): Set<string> {
  const ids = new Set<string>();

  for (const row of rows) {
    const { description } = row;
    if (typeof description !== "string") continue;
    if (!description.startsWith(GeneratedDescriptionPrefix)) continue;

    const [blockId] = description
      .slice(GeneratedDescriptionPrefix.length)
      .split(BlockDescriptionSeparator);
    if (blockId) ids.add(blockId);
  }

  return ids;
}

/**
 * The apply state a block opens in.
 *
 * `routines-only` is not merely a live outcome — it is a condition the
 * experiment can be SITTING IN. If the content upload failed and the researcher
 * switched tabs, the routines are on the server and the block's rows are not;
 * re-opening the tab with a clean "ready" bar and `~` verbs would say the
 * opposite, and the block would look applied while its trials do not exist.
 *
 * So the two facts are checked rather than remembered: no content row carries
 * the block's id, and the Builder already holds exactly the routines the block
 * compiles. The second is `diffCompiled` rather than a name check because two
 * blocks over the same trial routine share all three names — matching on names
 * alone would open a second, never-applied block in `routines-only` and its
 * Retry upload would then write that block's rows against the first block's
 * routines. No drift means the saved routines ARE this block's, so uploading
 * its content alone is exactly the right repair.
 */
export function initialApplyState(
  design: SessionDesign,
  routines: RoutineConfig[],
  idsWithRows: Set<string>,
): ApplyState {
  if (idsWithRows.has(design.id)) return "idle";

  const drift = diffCompiled(compileSessionDesign(design), routines);
  return drift.length === 0 ? "routines-only" : "idle";
}

/**
 * Replace one design in the list by id, merging `patch` into it. Returns the
 * same array reference when no design carries that id, so a stale edit cannot
 * mark the experiment dirty.
 */
export function replaceDesign<T extends { id: string }>(
  designs: T[],
  id: string,
  patch: Partial<T>,
): T[] {
  const index = designs.findIndex((d) => d.id === id);
  if (index === -1) return designs;

  const next = [...designs];
  next[index] = { ...next[index], ...patch };
  return next;
}

/**
 * A label not already taken by another block: `base`, then `base 2`, `base 3`.
 * The block switcher shows labels only, so duplicates would be unusable.
 */
export function uniqueLabel(existing: string[], base: string): string {
  if (!existing.includes(base)) return base;

  let suffix = 2;
  while (existing.includes(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}
