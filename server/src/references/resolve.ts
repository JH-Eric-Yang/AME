/**
 * resolve — substitute `ref:` values into element params for ONE participant.
 *
 * Runs inside deliverContent, after content overrides are merged and before
 * role filtering, so the browser only ever receives the values that were
 * referenced. Lookups are injected: the resolver knows nothing about Prisma
 * and is tested with stubs (`resolveReferences.test.ts`).
 */

import type { ElementConfig, RoutineConfig } from "ame-shared";
import {
  parseRef,
  findTemplateRefs,
  replaceTemplateRefs,
  forEachString,
  mapDeep,
  isRef,
  type ParsedRef,
  type RefWhere,
  type RefKind,
} from "ame-shared/refs";
import {
  resolveParticipant,
  type AddressingContext,
  type AddressingFailure,
} from "ame-shared/participantRef";
import { elementRefKind, referencedElement } from "ame-shared/producers";
import { transcriptText, TranscriptTextField } from "ame-shared/videoChat";

export interface UploadRecord {
  id: string;
  status: string;
  filePath: string | null;
  mimeType: string;
}

export interface ResultRecord {
  routine: string;
  response: Record<string, unknown>;
}

export interface ReferenceLookups {
  /** Newest result row for this participant at `where`; the response is keyed by element name. */
  latestResult(participantId: string, where: RefWhere): Promise<ResultRecord | null>;
  /** Newest upload row this participant made for `element` at `where`. */
  latestUpload(participantId: string, where: RefWhere, element: string): Promise<UploadRecord | null>;
}

export type UnresolvedReason =
  | AddressingFailure
  | "no-result"
  | "upload-not-complete"
  | "malformed"
  | "lookup-failed";

export interface Unresolved {
  ref: string;
  reason: UnresolvedReason;
}

export interface ResolveContext extends AddressingContext {
  routines: RoutineConfig[];
  lookups: ReferenceLookups;
  mintMediaUrl: (upload: UploadRecord) => string;
}

export interface ResolveOutcome {
  elements: ElementConfig[];
  /** Every gap found, across all elements. */
  unresolved: Unresolved[];
  /** The same gaps, keyed by the element whose params they were found in. */
  unresolvedByElement: Map<string, Unresolved[]>;
  /**
   * Every resolved ref, by raw string, unescaped. Content delivery reads the
   * ones a `showWhen` filter names; an unresolved ref is absent, so its filter fails.
   */
  values: Map<string, unknown>;
}

/**
 * A resolved value and where it came from. `media` is a URL this server just
 * minted; `value` is anything a participant produced — including the metadata
 * picked off an upload row. `substitute` escapes one and not the other.
 */
type Resolution =
  | { ok: true; value: unknown; origin: "value" | "media" }
  | { ok: false; reason: UnresolvedReason };

/** Media fields that select metadata instead of the URL. */
const MediaFields: Record<string, (u: UploadRecord) => unknown> = {
  uploadId: (u) => u.id,
  mimeType: (u) => u.mimeType,
};

const HtmlEscapes: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HtmlEscapes[c]);
}

/**
 * The first element of that name in authoring order; two routines sharing a name
 * is reported by the Progress tab. `<tile>__transcript` names a recorded tile's
 * transcript, which reads as a text tile (see `referencedElement`).
 */
function findElement(routines: RoutineConfig[], element: string): ElementConfig | undefined {
  for (const routine of routines) {
    const found = referencedElement(routine.elements, element);
    if (found) return found;
  }
  return undefined;
}

/**
 * The kind an element name produces. A video-chat tile decides by its params:
 * a recorded tile is media, a text tile is its transcript (spec §2.2).
 */
function kindOf(routines: RoutineConfig[], element: string): RefKind {
  const found = findElement(routines, element);
  return (found && elementRefKind(found)) ?? "value";
}

function selectPath(value: unknown, field: string | undefined): unknown {
  if (field === undefined) return value;
  let current: unknown = value;
  for (const key of field.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

async function resolveOne(ref: ParsedRef, ctx: ResolveContext): Promise<Resolution> {
  const who = resolveParticipant(ref.who, ctx);
  if (!who.ok) return who;

  // A media element name is decided by the routines, not by whether an
  // upload happens to exist — a textfield that shares a name with a
  // recorder elsewhere must still read as a value.
  const kind = kindOf(ctx.routines, ref.element);

  if (kind === "media") {
    const upload = await ctx.lookups.latestUpload(who.participantId, ref.where, ref.element);
    if (!upload) return { ok: false, reason: "no-result" };
    if (upload.status !== "COMPLETE" || !upload.filePath) {
      return { ok: false, reason: "upload-not-complete" };
    }
    if (ref.field !== undefined) {
      // An unknown field on a media element selects nothing. Falling through to
      // the URL would hand `{{ref:…/clip.duration}}` a video URL as its "duration".
      if (!Object.hasOwn(MediaFields, ref.field)) return { ok: false, reason: "no-result" };
      return { ok: true, value: MediaFields[ref.field](upload), origin: "value" };
    }
    return { ok: true, value: ctx.mintMediaUrl(upload), origin: "media" };
  }

  const result = await ctx.lookups.latestResult(who.participantId, ref.where);
  if (!result) return { ok: false, reason: "no-result" };
  const raw = result.response[ref.element];
  // `.text` on a tile's transcript joins its messages; every other field is a plain path.
  const joinsTranscript =
    ref.field === TranscriptTextField && Array.isArray(raw) && findElement(ctx.routines, ref.element)?.type === "video-chat";
  const value = joinsTranscript ? transcriptText(raw as { text: string }[]) : selectPath(raw, ref.field);
  if (value === undefined) return { ok: false, reason: "no-result" };
  return { ok: true, value, origin: "value" };
}

function asTemplateText(value: unknown): string {
  if (typeof value === "string") return escapeHtml(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  return escapeHtml(JSON.stringify(value));
}

/**
 * Every raw ref string inside `value`, whole-value and templated,
 * deduplicated. Shares its recursion with `substitute` below via
 * `forEachString`, so collection and substitution can't drift apart.
 */
function collectRawRefs(value: unknown, into: Set<string>): void {
  forEachString(value, (s) => {
    if (isRef(s)) into.add(s);
    else findTemplateRefs(s).forEach((raw) => into.add(raw));
  });
}

/**
 * `mapDeep` over `value`: a whole-value ref becomes its resolved value (any
 * JSON type — a number stays a number, and only a participant-authored string
 * is escaped), a templated ref is spliced into its surrounding string as
 * escaped text, and an unresolved ref of either shape becomes `""`.
 *
 * A whole-value string lands in a param the client may render as `{@html}`
 * (`ElText`), so it is escaped here, at the one place participant data enters
 * another participant's params. A minted media URL is not: escaping its `&`
 * would break the `src` it becomes. `defaultValue` is the exemption: it feeds
 * an input's value, which the client escapes itself, so `substituteParams`
 * routes it through `substituteRaw`.
 */
function substitute(value: unknown, resolved: Map<string, Resolution>): unknown {
  return mapDeep(value, (s) => {
    if (isRef(s)) {
      const r = resolved.get(s);
      if (!r?.ok) return "";
      return r.origin === "value" && typeof r.value === "string" ? escapeHtml(r.value) : r.value;
    }
    return replaceTemplateRefs(s, (raw) => {
      const r = resolved.get(raw);
      return r?.ok ? asTemplateText(r.value) : "";
    });
  });
}

/** Participant data that feeds an input's value: never escaped, types kept. */
const DefaultValueParam = "defaultValue";

function asPlainText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

function substituteRaw(value: unknown, resolved: Map<string, Resolution>): unknown {
  return mapDeep(value, (s) => {
    if (isRef(s)) {
      const r = resolved.get(s);
      return r?.ok ? r.value : "";
    }
    return replaceTemplateRefs(s, (raw) => {
      const r = resolved.get(raw);
      return r?.ok ? asPlainText(r.value) : "";
    });
  });
}

function substituteParams(params: unknown, resolved: Map<string, Resolution>): unknown {
  if (params === null || typeof params !== "object" || Array.isArray(params)) return substitute(params, resolved);
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      key === DefaultValueParam ? substituteRaw(value, resolved) : substitute(value, resolved),
    ]),
  );
}

/** Whole refs used as a `showWhen` property; a filter compares the entire string. */
function conditionRefs(element: ElementConfig): string[] {
  return (element.showWhen ?? []).map((filter) => filter.property).filter(isRef);
}

export async function resolveReferences(
  elements: ElementConfig[],
  ctx: ResolveContext,
): Promise<ResolveOutcome> {
  const raws = new Set<string>();
  for (const element of elements) {
    collectRawRefs(element.params, raws);
    conditionRefs(element).forEach((raw) => raws.add(raw));
  }
  if (raws.size === 0) return { elements, unresolved: [], unresolvedByElement: new Map(), values: new Map() };

  const resolved = new Map<string, Resolution>();
  const unresolved: Unresolved[] = [];
  const gapByRaw = new Map<string, Unresolved>();
  const reportGap = (raw: string, reason: UnresolvedReason): void => {
    const gap = { ref: raw, reason };
    unresolved.push(gap);
    gapByRaw.set(raw, gap);
  };

  for (const raw of raws) {
    const parsed = parseRef(raw);
    // A malformed ref is an authoring error the Progress tab reports rather
    // than a lookup that failed, but it still substitutes "" — reported here
    // so the gap is visible instead of a silently blank element.
    if (!parsed) {
      reportGap(raw, "malformed");
      continue;
    }
    // A lookup that throws costs one reference, never the delivery: the
    // participant sees an empty value and the ref is reported like any other.
    let outcome: Resolution;
    try {
      outcome = await resolveOne(parsed, ctx);
    } catch (err) {
      console.warn(`[references] lookup failed for ${raw}:`, err);
      outcome = { ok: false, reason: "lookup-failed" };
    }
    resolved.set(raw, outcome);
    if (!outcome.ok) reportGap(raw, outcome.reason);
  }

  const values = new Map<string, unknown>();
  for (const [raw, outcome] of resolved) {
    if (outcome.ok) values.set(raw, outcome.value);
  }

  const unresolvedByElement = new Map<string, Unresolved[]>();
  const out = elements.map((element) => {
    const touched = new Set<string>();
    collectRawRefs(element.params, touched);
    conditionRefs(element).forEach((raw) => touched.add(raw));
    if (touched.size === 0) return element;
    const gaps = [...touched]
      .map((raw) => gapByRaw.get(raw))
      .filter((gap): gap is Unresolved => gap !== undefined);
    if (gaps.length > 0) unresolvedByElement.set(element.name, gaps);
    return { ...element, params: substituteParams(element.params, resolved) as ElementConfig["params"] };
  });

  return { elements: out, unresolved, unresolvedByElement, values };
}
