/**
 * overrides — the Progress tab's view of a content row: per element, which
 * params this step overrides on top of the routine's defaults.
 *
 * Storage is unchanged from before the tab existed — `content[element]` is
 * a partial params object the server shallow-merges over `element.params` —
 * so the session designer, the seed script and the resolver see nothing new.
 */

import type { ElementConfig } from "ame-shared";

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

export function overrideOf(content: Record<string, unknown>, element: string): Record<string, unknown> | null {
  const entry = content[element];
  return isObject(entry) ? entry : null;
}

export function mergedParams(element: ElementConfig, content: Record<string, unknown>): Record<string, unknown> {
  return { ...(element.params as Record<string, unknown>), ...(overrideOf(content, element.name) ?? {}) };
}

/**
 * The keys of `merged` that differ from `defaults`. A key the editor cleared
 * (`undefined`) is dropped: a merge cannot remove a default, so the routine's
 * value stands and the step simply stops overriding it.
 *
 * The comparison is `JSON.stringify` and therefore key-order sensitive: an
 * object an editor rebuilt with its keys in another order records an override
 * that changes nothing. Harmless — the merge yields the same params — but it
 * is why a step can show an override no one meant to make.
 */
export function overridePatch(
  defaults: Record<string, unknown>,
  merged: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) continue;
    if (JSON.stringify(value) !== JSON.stringify(defaults[key])) patch[key] = value;
  }
  return patch;
}

export function withOverride(
  content: Record<string, unknown>,
  element: string,
  override: Record<string, unknown> | null,
): Record<string, unknown> {
  const { [element]: _removed, ...rest } = content;
  return override === null ? rest : { ...rest, [element]: override };
}
