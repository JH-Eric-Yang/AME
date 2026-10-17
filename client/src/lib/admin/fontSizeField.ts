/**
 * Bridges the Inspector's px number field and the CSS string `TextParams.fontSize`
 * stores. A size in any other unit parses to null so the field shows blank and
 * the stored value is left alone until the researcher types a number.
 */

/** A bare number with a px suffix, whitespace tolerated. */
const PxPattern = /^\s*(\d+(?:\.\d+)?)px\s*$/;

/**
 * Parses a px value from a CSS string.
 * Returns the numeric value if the string is a valid px measurement (e.g., "16px", "12.5px").
 * Returns null for any other unit, invalid format, or unset value, so the field shows blank.
 */
export function parsePx(value: string | undefined): number | null {
  if (!value) return null;
  const match = PxPattern.exec(value);
  return match ? Number(match[1]) : null;
}

/**
 * Formats a numeric value as a CSS px string.
 */
export function formatPx(n: number): string {
  return `${n}px`;
}
