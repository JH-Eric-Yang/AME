/**
 * A CSS declaration set as a plain object.
 *
 * Geometry functions return these rather than strings so that tests can assert
 * with toEqual instead of matching substrings, and so callers can merge them.
 */
export type StyleMap = Record<string, string>;

export function styleString(m: StyleMap): string {
  return Object.entries(m)
    .map(([property, value]) => `${property}: ${value}`)
    .join("; ");
}
