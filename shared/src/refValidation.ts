/**
 * refValidation — the reference rules of spec §4, evaluated against one
 * condition's sequence: can this ref be resolved for every participant, in
 * every ordering randomization can produce, from the step it sits on?
 *
 * Pure. `contentValidation.ts` runs these on save (errors block); the
 * Progress tab runs them live; the ReferencePicker uses `refSafety` and
 * `elementsAvailable` to grey out what would fail.
 */

import type { ElementConfig, ElementType, RandomizationRange, RoutineConfig, VideoChatParams } from "./types.js";
import { parseRef, findTemplateRefs, isRef, parseParticipantRef, type ParsedRef, type RefWhere, type RefKind } from "./refs.js";
import {
  stepsFor,
  matchingBands,
  shuffledRanges,
  bandAt,
  rangeAt,
  groupSizeAt,
  type Band,
  type SequenceRow,
  type ShuffledRange,
  type Step,
} from "./progressSequence.js";
import { elementRefKind, referableElements, referencedElement } from "./producers.js";
import { mediaChannels, hasTextChannel, isSelfTile, tileParticipant, type MediaChannel } from "./videoChat.js";

export type IssueLevel = "error" | "warn";

export interface RefIssue {
  level: IssueLevel;
  ref: string;
  message: string;
}

/** One `ref:` found in an element's (merged) params. */
export interface RefSite {
  raw: string;
  parsed: ParsedRef | null;
  element: string;
  /** Top-level param key the ref sits under. A `showWhen` condition's site uses the synthetic key `"showWhen"`. */
  param: string;
  /** True when the whole string is the ref; false for `{{ }}` templates. */
  whole: boolean;
}

export interface SequenceContext {
  condition: string;
  steps: Step[];
  routines: RoutineConfig[];
  bands: Band[];
  ranges: ShuffledRange[];
}

export type Safety = { ok: true; targets: Step[] } | { ok: false; message: string };

/** Element types whose whole-value `src` must be media. */
const MediaSrcElements: ReadonlySet<ElementType> = new Set<ElementType>(["image", "video", "audio"]);
const SrcParam = "src";
const DefaultValueParam = "defaultValue";
/** The `param` a site reports when its ref is a `showWhen` filter's property. */
const ShowWhenParam = "showWhen";
const VideoChatType: ElementType = "video-chat";

export function sequenceContext(
  rows: SequenceRow[],
  condition: string,
  routines: RoutineConfig[],
  ranges: RandomizationRange[],
): SequenceContext {
  const steps = stepsFor(rows, condition);
  return { condition, steps, routines, bands: matchingBands(steps, routines), ranges: shuffledRanges(steps, ranges) };
}

const routineOf = (ctx: SequenceContext, step: Step): RoutineConfig | undefined =>
  ctx.routines.find((r) => r.name === step.routine);

function walkStrings(value: unknown, visit: (s: string) => void): void {
  if (typeof value === "string") visit(value);
  else if (Array.isArray(value)) value.forEach((v) => walkStrings(v, visit));
  else if (value !== null && typeof value === "object") Object.values(value).forEach((v) => walkStrings(v, visit));
}

export function findRefSites(elements: ElementConfig[], content: Record<string, unknown>): RefSite[] {
  const sites: RefSite[] = [];
  for (const element of elements) {
    const override = content[element.name];
    const params = {
      ...(element.params as Record<string, unknown>),
      ...(override && typeof override === "object" && !Array.isArray(override) ? (override as Record<string, unknown>) : {}),
    };
    for (const [param, value] of Object.entries(params)) {
      walkStrings(value, (s) => {
        if (isRef(s)) sites.push({ raw: s, parsed: parseRef(s), element: element.name, param, whole: true });
        else for (const raw of findTemplateRefs(s)) sites.push({ raw, parsed: parseRef(raw), element: element.name, param, whole: false });
      });
    }

    // A condition's property is compared whole; a ref is only meaningful there as the entire string.
    for (const filter of element.showWhen ?? []) {
      if (isRef(filter.property)) {
        sites.push({ raw: filter.property, parsed: parseRef(filter.property), element: element.name, param: ShowWhenParam, whole: true });
      }
    }
  }
  return sites;
}

export function requiredKind(site: RefSite, elementType: ElementType): RefKind {
  return site.whole && site.param === SrcParam && MediaSrcElements.has(elementType) ? "media" : "value";
}

const stepAt = (ctx: SequenceContext, position: number): Step | undefined =>
  ctx.steps.find((s) => s.position === position);

export function refSafety(where: RefWhere, from: number, ctx: SequenceContext): Safety {
  if (where.kind === "position") {
    const n = where.n;
    const target = stepAt(ctx, n);
    if (!target) return { ok: false, message: `p${n} names no step in this condition` };
    if (n >= from) return { ok: false, message: `p${n} is not before p${from}` };
    const range = rangeAt(ctx.ranges, n);
    if (range && rangeAt(ctx.ranges, from) === range) {
      return { ok: false, message: `p${n} and p${from} are both in a shuffled range (p${range.from}–p${range.to}) and may swap; use t<K>` };
    }
    return { ok: true, targets: range ? range.positions.map((p) => stepAt(ctx, p)!) : [target] };
  }

  const label = where.routine ? `t${where.k}:${where.routine}` : `t${where.k}`;
  const candidates = ctx.steps.filter(
    (s) => s.trial === where.k && (!where.routine || s.routine === where.routine),
  );
  if (candidates.length === 0) return { ok: false, message: `${label} names no step in this condition` };

  const own = stepAt(ctx, from);
  if (own && own.trial === where.k) {
    const earlier = candidates.filter((s) => s.position < from);
    if (earlier.length === 0) return { ok: false, message: `t${where.k}: no earlier step of trial ${where.k} before p${from}` };
    return { ok: true, targets: earlier };
  }

  const range = candidates.map((c) => rangeAt(ctx.ranges, c.position)).find((r) => r !== null) ?? null;
  if (range && from <= range.to) {
    return { ok: false, message: `t${where.k} may run after p${from}: p${from} is inside or before the shuffled range p${range.from}–p${range.to}` };
  }
  const late = candidates.find((c) => c.position >= from);
  if (!range && late) return { ok: false, message: `t${where.k} at p${late.position} is not before p${from}` };
  return { ok: true, targets: candidates };
}

export function elementsAvailable(targets: Step[], routines: RoutineConfig[], kind: RefKind | null): ElementConfig[] {
  if (targets.length === 0) return [];
  const byName = new Map(routines.map((r) => [r.name, r]));
  const first = referableElements(byName.get(targets[0].routine)?.elements ?? []);
  return first.filter((element) => {
    const produced = elementRefKind(element);
    if (!produced || (kind && produced !== kind)) return false;
    return targets.every((t) => referencedElement(byName.get(t.routine)?.elements ?? [], element.name));
  });
}

/** Why a producer might not have run for a participant, or null when it always does. */
function optionalReason(element: ElementConfig): string | null {
  if (element.showForRoles && element.showForRoles.length > 0) return `shown only to ${element.showForRoles.join(", ")}`;
  if (element.showForSeats && element.showForSeats.length > 0) return `shown only to seats ${element.showForSeats.join(", ")}`;
  if (element.showWhen && element.showWhen.length > 0) return "shown conditionally";
  if (element.onsetTime && element.onsetTime > 0) return `onset at ${element.onsetTime} ms`;
  if (element.duration) return `disappears after ${element.duration} ms`;
  return null;
}

/** What a whole-value ref must yield a value for, named for the message; null when media is acceptable. */
function valueSurface(site: RefSite): string | null {
  if (!site.whole) return null;
  if (site.param === ShowWhenParam) return "a condition";
  if (site.param === DefaultValueParam) return "a default value";
  return null;
}

export function validateRef(site: RefSite, from: Step, ctx: SequenceContext): RefIssue[] {
  const error = (message: string): RefIssue => ({ level: "error", ref: site.raw, message });
  const ref = site.parsed;
  if (!ref) return [error(`\`${site.raw}\` does not parse`)];

  const routine = routineOf(ctx, from);
  if (ref.who.kind !== "self") {
    const band = bandAt(ctx.bands, from.position);
    if (!band) {
      return [error(`\`${site.raw}\` needs a matching block: p${from.position} is outside routine-matching → routine-end-matching`)];
    }
    if (ref.who.kind === "partner") {
      const group = groupSizeAt(band, routine);
      if (ref.who.k > group - 1) {
        return [error(`\`${site.raw}\`: the group at p${from.position} has ${group} members, so the last partner is partner:${group - 1}`)];
      }
    } else if (ref.who.n > band.cohortSize) {
      return [error(`\`${site.raw}\`: the cohort has ${band.cohortSize} seats`)];
    }
  }

  const safety = refSafety(ref.where, from.position, ctx);
  if (!safety.ok) return [error(safety.message)];

  const byName = new Map(ctx.routines.map((r) => [r.name, r]));
  const holders = safety.targets.filter((t) => referencedElement(byName.get(t.routine)?.elements ?? [], ref.element));

  // With a `:routine` qualifier the candidates already share one routine, so
  // more than one holder is still ambiguous: the qualifier narrows which steps
  // are candidates, it does not pick between two of them.
  if (ref.where.kind === "trial" && holders.length > 1) {
    const names = [...new Set(holders.map((h) => h.routine))].join(", ");
    const at = holders.map((h) => `p${h.position}`).join(", ");
    return [error(`\`${site.raw}\` is ambiguous: trial ${ref.where.k} runs ${names} at ${at}; add :routine or use p<N>`)];
  }

  // A position ref's targets are randomization alternatives: every one of them
  // must carry the element, since any could land there. A trial ref's other
  // candidates are sibling routines of the same trial, not alternatives — once
  // the element is found unambiguously in one of them, the rest are not "missing".
  const missing =
    ref.where.kind === "trial" && holders.length > 0 ? [] : safety.targets.filter((t) => !holders.includes(t));
  if (missing.length > 0) {
    return missing.map((t) => error(`\`${site.raw}\`: ${t.routine} at p${t.position} has no element "${ref.element}"`));
  }

  const issues: RefIssue[] = [];
  const need = requiredKind(site, routine?.elements.find((e) => e.name === site.element)?.type ?? "text");
  for (const target of holders) {
    const producer = referencedElement(byName.get(target.routine)!.elements, ref.element)!;
    const produced = elementRefKind(producer);
    if (!produced) {
      issues.push(error(`\`${site.raw}\`: "${producer.name}" (${producer.type}) produces nothing to reference`));
      continue;
    }
    if (need === "media" && produced !== "media") {
      issues.push(error(`\`${site.raw}\`: a media source needs a recording or file, but "${producer.name}" is a ${producer.type}`));
      continue;
    }
    const surface = valueSurface(site);
    if (surface && produced === "media") {
      issues.push(error(`\`${site.raw}\`: ${surface} needs a recorded answer, but "${producer.name}" is a ${producer.type}`));
      continue;
    }
    const reason = optionalReason(producer);
    if (reason) issues.push({ level: "warn", ref: site.raw, message: `\`${site.raw}\`: "${producer.name}" may not have run for every participant (${reason})` });
  }
  return dedupe(issues);
}

function dedupe(issues: RefIssue[]): RefIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => (seen.has(i.message) ? false : (seen.add(i.message), true)));
}

/** A tile's params as the runtime will see them on this step: defaults merged with the row's override. */
function tileParams(element: ElementConfig, content: Record<string, unknown>): VideoChatParams {
  const override = content[element.name];
  return {
    ...(element.params as VideoChatParams),
    ...(override && typeof override === "object" && !Array.isArray(override) ? (override as VideoChatParams) : {}),
  };
}

/** Two tiles are on one screen unless both are role-restricted to roles that never meet. */
function sharesScreen(a: ElementConfig, b: ElementConfig): boolean {
  const ra = a.showForRoles ?? [];
  const rb = b.showForRoles ?? [];
  if (ra.length === 0 || rb.length === 0) return true;
  return ra.some((role) => rb.includes(role));
}

/** The §4 / §6.1 checks on a step's video-chat tiles. */
function tileIssues(step: Step, routine: RoutineConfig, content: Record<string, unknown>, ctx: SequenceContext): RefIssue[] {
  const tiles = routine.elements
    .filter((element) => element.type === VideoChatType)
    .map((element) => ({ element, params: tileParams(element, content) }));
  if (tiles.length === 0) return [];

  const issues: RefIssue[] = [];
  const error = (message: string): RefIssue => ({ level: "error", ref: "", message });
  const warn = (message: string): RefIssue => ({ level: "warn", ref: "", message });
  const band = bandAt(ctx.bands, step.position);

  for (const { element, params } of tiles) {
    const raw = tileParticipant(params);
    const who = parseParticipantRef(raw);
    if (!who) {
      issues.push(error(`video-chat "${element.name}": "${raw}" is not self, partner, partner:k or seat:n`));
    } else if (band && who.kind === "partner") {
      const group = groupSizeAt(band, routine);
      if (who.k > group - 1) {
        issues.push(error(`video-chat "${element.name}": the group at p${step.position} has ${group} members, so the last partner is partner:${group - 1}`));
      }
    } else if (band && who.kind === "seat" && who.n > band.cohortSize) {
      issues.push(error(`video-chat "${element.name}": the cohort has ${band.cohortSize} seats`));
    }
    if (params.record === true && mediaChannels(params).length === 0) {
      issues.push(error(`video-chat "${element.name}" records, but lists no video or audio channel`));
    }
  }

  const textTiles = tiles.filter((t) => hasTextChannel(t.params));
  const clashing = new Set<string>();
  for (let i = 0; i < textTiles.length; i++) {
    for (let j = i + 1; j < textTiles.length; j++) {
      if (sharesScreen(textTiles[i].element, textTiles[j].element)) {
        clashing.add(textTiles[i].element.name);
        clashing.add(textTiles[j].element.name);
      }
    }
  }
  if (clashing.size > 1) {
    const names = textTiles.map((t) => t.element.name).filter((n) => clashing.has(n));
    issues.push(warn(`video-chat tiles ${names.map((n) => `"${n}"`).join(", ")} show the same text thread; keep text on one tile`));
  }

  // A screen publishes its self tiles' media channels, or — with no self tile —
  // the media channels of the tiles it renders (spec §6.1).
  const roles: (string | null)[] = routine.roles && routine.roles.length > 0 ? routine.roles : [null];
  const visible = (element: ElementConfig, role: string | null): boolean =>
    !element.showForRoles?.length || (role !== null && element.showForRoles.includes(role));
  const publishes = (role: string | null): Set<MediaChannel> => {
    const own = tiles.filter((t) => visible(t.element, role));
    const selves = own.filter((t) => isSelfTile(t.params));
    return new Set((selves.length > 0 ? selves : own).flatMap((t) => mediaChannels(t.params)));
  };
  const reported = new Set<string>();
  for (const role of roles) {
    const publishers = roles.length > 1 ? roles.filter((r) => r !== role) : roles;
    for (const { element, params } of tiles) {
      if (!visible(element, role) || isSelfTile(params)) continue;
      for (const channel of mediaChannels(params)) {
        if (publishers.some((r) => publishes(r).has(channel))) continue;
        const key = `${element.name}:${channel}`;
        if (reported.has(key)) continue;
        reported.add(key);
        issues.push(warn(`video-chat "${element.name}" expects ${channel} from its participant, but no screen in this routine publishes ${channel}`));
      }
    }
  }
  return issues;
}

export function validateStepRefs(step: Step, rows: SequenceRow[], ctx: SequenceContext): RefIssue[] {
  const routine = routineOf(ctx, step);
  if (!routine) return [];
  const content = rows[step.rowIndex]?.content ?? {};
  const issues = findRefSites(routine.elements, content).flatMap((site) => validateRef(site, step, ctx));

  for (const element of routine.elements) {
    const hasBlankCondition = (element.showWhen ?? []).some((filter) => filter.property.trim() === "");
    if (hasBlankCondition) {
      issues.push({
        level: "warn",
        ref: "",
        message: `showWhen on "${element.name}" has a condition with no property, so the element is never shown`,
      });
    }
  }

  if (!bandAt(ctx.bands, step.position)) {
    for (const element of routine.elements) {
      if (element.type === VideoChatType) {
        issues.push({ level: "error", ref: "", message: `video-chat "${element.name}" is outside a matching block` });
      }
    }
  }
  issues.push(...tileIssues(step, routine, content, ctx));
  return issues;
}
