/**
 * textInsert — splicing a `{{ref:…}}` into a textarea at the caret (or over a
 * selection), used by `TextParamsEditor`'s "Insert reference…" affordance.
 * Pure so it can be unit-tested without mounting a component.
 */

/** Splice `insert` into `text` over `[start, end)`; out-of-range positions append. */
export function insertAt(text: string, start: number, end: number, insert: string): { text: string; caret: number } {
  const valid = start >= 0 && start <= text.length && end >= start && end <= text.length;
  const from = valid ? start : text.length;
  const to = valid ? end : text.length;
  const next = `${text.slice(0, from)}${insert}${text.slice(to)}`;
  return { text: next, caret: from + insert.length };
}
