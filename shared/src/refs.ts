/**
 * refs — the `ref:` grammar that lets a later progress read what an earlier
 * one collected.
 *
 *   ref:<who>/<where>/<element>[.<field>]
 *   who   := self | partner | partner:<k> | seat:<n>
 *   where := p<N> | t<K> | t<K>:<routine>
 *
 * `p<N>` is the 0-based position the participant experienced (what the runtime
 * stores as `progress`); `t<K>` is a content row's `trialNumber`, which is
 * position-independent under randomization. `k` and `n` are 1-based.
 *
 * Pure. The server resolves refs (`server/src/references/resolve.ts`); the
 * admin UI writes and rewrites them. Nothing here touches a database.
 */

import type { ElementType } from "./types.js";

export const RefPrefix = "ref:";

export type ParticipantRef =
  | { kind: "self" }
  | { kind: "partner"; k: number }
  | { kind: "seat"; n: number };

export type RefWhere =
  | { kind: "position"; n: number }
  | { kind: "trial"; k: number; routine?: string };

export interface ParsedRef {
  who: ParticipantRef;
  where: RefWhere;
  element: string;
  field?: string;
}

/** What a producing element yields when referenced. */
export type RefKind = "media" | "value";

// A participant reference on its own: "self", "partner", "partner:2", "seat:3".
const ParticipantPattern = /^(?:(self)|(partner)(?::([1-9]\d*))?|seat:([1-9]\d*))$/;

// Element names are free text in the builder but may not contain "/" (a
// segment separator) or "." (the field separator) or whitespace.
const ElementNamePattern = "[^/.\\s]+";

// The whole reference. Groups: 1 who, 2 position, 3 trial, 4 routine,
// 5 element, 6 field.
const RefPattern = new RegExp(
  `^ref:(self|partner(?::[1-9]\\d*)?|seat:[1-9]\\d*)/(?:p(0|[1-9]\\d*)|t([1-9]\\d*)(?::([^/\\s]+))?)/(${ElementNamePattern})(?:\\.(\\S+))?$`,
);

// `{{ ref:… }}` inside text. Inner whitespace is tolerated; the ref itself
// contains none.
const TemplatePattern = /\{\{\s*(ref:\S+?)\s*\}\}/g;

export function parseParticipantRef(s: string): ParticipantRef | null {
  const m = ParticipantPattern.exec(s);
  if (!m) return null;
  if (m[1]) return { kind: "self" };
  if (m[2]) return { kind: "partner", k: m[3] ? Number(m[3]) : 1 };
  return { kind: "seat", n: Number(m[4]) };
}

export function formatParticipantRef(who: ParticipantRef): string {
  switch (who.kind) {
    case "self":
      return "self";
    case "partner":
      return who.k === 1 ? "partner" : `partner:${who.k}`;
    case "seat":
      return `seat:${who.n}`;
  }
}

export function parseRef(s: string): ParsedRef | null {
  const m = RefPattern.exec(s);
  if (!m) return null;

  const who = parseParticipantRef(m[1]);
  if (!who) return null;

  const where: RefWhere =
    m[2] !== undefined
      ? { kind: "position", n: Number(m[2]) }
      : m[4] !== undefined
        ? { kind: "trial", k: Number(m[3]), routine: m[4] }
        : { kind: "trial", k: Number(m[3]) };

  const ref: ParsedRef = { who, where, element: m[5] };
  if (m[6] !== undefined) ref.field = m[6];
  return ref;
}

function formatWhere(where: RefWhere): string {
  if (where.kind === "position") return `p${where.n}`;
  return where.routine ? `t${where.k}:${where.routine}` : `t${where.k}`;
}

export function formatRef(ref: ParsedRef): string {
  const field = ref.field ? `.${ref.field}` : "";
  return `${RefPrefix}${formatParticipantRef(ref.who)}/${formatWhere(ref.where)}/${ref.element}${field}`;
}

export function isRef(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(RefPrefix);
}

/** Every `{{ref:…}}` in `text`, as raw strings, in order. Malformed ones are kept: the caller decides. */
export function findTemplateRefs(text: string): string[] {
  return Array.from(text.matchAll(TemplatePattern), (m) => m[1]);
}

/**
 * Every `{{ref:…}}` in `text` replaced by `replace(raw)` — the whole
 * `{{…}}` span is swapped for whatever `replace` returns, so a caller that
 * wants to keep the template markers (as `remapPositionRefs` does) must
 * re-wrap its result in `{{ }}` itself. The one other place `TemplatePattern`
 * is applied, alongside `findTemplateRefs` above.
 */
export function replaceTemplateRefs(text: string, replace: (raw: string) => string): string {
  return text.replace(TemplatePattern, (_whole, raw: string) => replace(raw));
}

// ── Generic walkers ────────────────────────────────────
//
// `findRefs`, `remapPositionRefs` and the server's resolver (`resolve.ts`)
// all walk the same JSON shape — element params: strings, arrays, and plain
// objects. These own that recursion once so the three callers can't diverge.

/** Visits every string inside `value`, depth-first, in the order it appears. */
export function forEachString(value: unknown, visit: (s: string) => void): void {
  if (typeof value === "string") {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => forEachString(entry, visit));
    return;
  }
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach((entry) => forEachString(entry, visit));
  }
}

/**
 * A deep copy of `value` with every string replaced by `fn(s)`. `fn` may
 * return any JSON value — needed where a whole-value ref must become a
 * non-string (e.g. a resolved number) — so `mapDeep` itself isn't typed
 * string-to-string; `mapStrings` below is the constrained, common case.
 * Arrays and objects are rebuilt from their mapped entries; other
 * primitives (number, boolean, null) pass through unchanged.
 */
export function mapDeep<T>(value: T, fn: (s: string) => unknown): T {
  if (typeof value === "string") return fn(value) as T;
  if (Array.isArray(value)) return value.map((entry) => mapDeep(entry, fn)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, mapDeep(entry, fn)]),
    ) as T;
  }
  return value;
}

/**
 * `mapDeep` constrained to string-to-string transforms. `fn` must leave a
 * string with no ref in it unchanged — `replaceTemplateRefs` already does,
 * since `.replace()` is a no-op wherever its pattern doesn't match.
 */
export function mapStrings<T>(value: T, fn: (s: string) => string): T {
  return mapDeep(value, fn) as T;
}

/** Whole-value refs and template refs anywhere inside `value`, parsed; malformed ones are skipped. */
export function findRefs(value: unknown): ParsedRef[] {
  const found: ParsedRef[] = [];
  const push = (raw: string): void => {
    const parsed = parseRef(raw);
    if (parsed) found.push(parsed);
  };

  forEachString(value, (s) => {
    if (isRef(s)) push(s);
    else findTemplateRefs(s).forEach(push);
  });

  return found;
}

function remapOne(raw: string, map: (n: number) => number): string {
  const parsed = parseRef(raw);
  if (!parsed || parsed.where.kind !== "position") return raw;
  return formatRef({ ...parsed, where: { kind: "position", n: map(parsed.where.n) } });
}

/**
 * A deep copy of `value` with every `p<N>` rewritten through `map`. Trial refs
 * are position-independent and left alone. Used when the Progress tab
 * inserts, moves or deletes a step.
 *
 * A template ref must stay a template ref (still `{{ }}`-wrapped) — only its
 * position number changes — so the callback re-wraps `remapOne`'s bare
 * `ref:…` result; `replaceTemplateRefs` itself doesn't assume that.
 */
export function remapPositionRefs<T>(value: T, map: (n: number) => number): T {
  return mapStrings(value, (s) =>
    isRef(s) ? remapOne(s, map) : replaceTemplateRefs(s, (raw) => `{{${remapOne(raw, map)}}}`),
  );
}

// Elements whose response is an uploaded file. `video-chat` is listed for the
// recorded-tile case that Phase 3 adds; a text-only tile refines this there.
//
// `multi-capture` records one upload per capture under `<name>__<label>`; until
// the producer model can expand a suffixed name (Phase 2) it is not
// referenceable.
const MediaProducers: ReadonlySet<ElementType> = new Set<ElementType>([
  "recorder",
  "input-file-picker",
  "video-chat",
]);

// Elements that write a value under their name in `runner.responses`.
const ValueProducers: ReadonlySet<ElementType> = new Set<ElementType>([
  "survey",
  "input-textfield",
  "input-select",
  "input-option-group",
  "input-slider",
  "button",
  "keyboard",
  "speech-recognizer",
  "volume-check",
  "body-detector",
  "facial-expression-detector",
  "timer",
]);

/** What referencing an element of this type yields, or null when it produces nothing. */
export function refKind(type: ElementType): RefKind | null {
  if (MediaProducers.has(type)) return "media";
  if (ValueProducers.has(type)) return "value";
  return null;
}
