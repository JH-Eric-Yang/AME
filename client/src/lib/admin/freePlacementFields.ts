/**
 * The x/y/w/h stage-percent fields in the Inspector.
 *
 * These are the control that makes a placement reproducible and reportable —
 * typing 50 has to mean exactly 50%, every time, not a mouse's approximation
 * of it. Kept as plain arithmetic on numbers/strings (no ame-shared import),
 * so it is tested from the client suite alongside the rest of the Inspector's
 * decision logic.
 */

/** Stage-percent fields are shown and stored to one decimal place. */
export const FreePlacementPrecision = 1;

/** Rounds a stage-percent value to the precision the fields display. */
export function roundPct(value: number): number {
  const factor = 10 ** FreePlacementPrecision;
  return Math.round(value * factor) / factor;
}

/** The text a stage-percent field shows for a given value. */
export function formatPct(value: number): string {
  return roundPct(value).toFixed(FreePlacementPrecision);
}

/**
 * Parses a stage-percent field's typed text, or null when it is not usable
 * yet (blank, or not a number) — the caller should leave the stored value
 * alone rather than commit a bad parse.
 */
export function parsePct(text: string): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? roundPct(n) : null;
}

/**
 * The text a field must be forced to so it reads `accepted`, or null when
 * the text already typed already reads as that value.
 *
 * Mirrors `correctedNumberText` (admin/numberInput.ts): Svelte only rewrites
 * `value={expr}` into the DOM when `expr` changes, so without this a
 * rejected or reformatted value (e.g. clamped, or rounded to one decimal on
 * blur) would leave the field showing text the design no longer holds.
 */
export function correctedPctText(typed: string, accepted: number): string | null {
  return typed.trim() === formatPct(accepted) ? null : formatPct(accepted);
}
