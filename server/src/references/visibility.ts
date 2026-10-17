/**
 * visibility — the property bag an element's `showWhen` is evaluated against.
 *
 * `evaluateFilters` looks a filter's property up by name and is shared with
 * matching-slot filters, so it is left alone. A filter whose property is a
 * `ref:` string finds the resolved value here, under that same string; plain
 * properties fall through to the participant's own. Property names never start
 * with `ref:`, so the two cannot collide.
 */
export function visibilityProperties(
  properties: Record<string, unknown>,
  values: ReadonlyMap<string, unknown>,
): Record<string, unknown> {
  return { ...properties, ...Object.fromEntries(values) };
}
