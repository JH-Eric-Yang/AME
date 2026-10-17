/**
 * Keeping a number input honest about the value the design actually holds.
 *
 * Svelte 5 writes `value={expr}` into the DOM only when `expr` CHANGES. A
 * design that refuses the typed text — an emptied Cohort size, a fractional
 * Trials, a clamped seat count — leaves `expr` exactly as it was, so the input
 * keeps showing text the block will never use. In this feature that is the
 * dangerous kind of wrong: the field reads 0 while the apply bar truthfully
 * promises to set Participants Per Session to 8, and only one of the two is
 * what gets written.
 *
 * So the handler asks this function what the input must now read, and forces
 * it. It is deliberately a comparison rather than an unconditional assignment:
 * rewriting the value on every keystroke would move the caret.
 */

/**
 * The text `input.value` must be forced to so the field shows `accepted`, or
 * null when the text the researcher typed already reads as that number.
 *
 * `typed` is compared trimmed, because a number input hands back the raw text
 * and " 8 " is the same number as "8"; anything else — "", "8.5", "007", a
 * clamped "999" — is rewritten.
 */
export function correctedNumberText(typed: string, accepted: number): string | null {
  return typed.trim() === String(accepted) ? null : String(accepted);
}
