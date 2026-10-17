/**
 * refOptions — the ReferencePicker's four option lists, computed from the
 * experiment, the content rows and the step the picker was opened from.
 * `from === null` is the Builder Inspector: it cannot know where the routine
 * will run, so nothing is disabled there and the Progress tab validates the
 * result per step (spec §7.2).
 */

import type { ElementType, RandomizationRange, RoutineConfig, VideoChatParams } from "ame-shared";
import { formatRef, parseParticipantRef, type RefKind, type RefWhere } from "ame-shared/refs";
import { bandAt, groupSizeAt, type SequenceRow, type Step } from "ame-shared/progressSequence";
import { sequenceContext, refSafety, elementsAvailable, type SequenceContext } from "ame-shared/refValidation";
import { elementRefKind } from "ame-shared/producers";
import { TranscriptTextField } from "ame-shared/videoChat";

export interface WhoOption { kind: "self" | "partner" | "seat"; label: string; max: number | null }
export interface WhereOption { value: RefWhere; label: string; disabledReason: string | null; targets: Step[] }
export interface FieldOption { value: string; label: string }
export interface ElementOption { name: string; type: ElementType; kind: RefKind; fields: FieldOption[] }

export interface RefOptionsInput {
  rows: SequenceRow[];
  condition: string;
  routines: RoutineConfig[];
  ranges: RandomizationRange[];
  /** The step the picker was opened from; null from the Builder Inspector. */
  from: number | null;
  kind: RefKind | null;
}

const SelfLabel = "Me";
const PartnerLabel = "My partner";
const SeatLabel = "A seat";
/** Sub-fields of a file-picker response: the first two files and the count. */
const FilePickerFields = ["0", "1", "count"];
const UploadFields = ["uploadId", "mimeType"];
const UploadProducers: ReadonlySet<ElementType> = new Set<ElementType>(["recorder", "multi-capture", "video-chat"]);

const context = (input: RefOptionsInput): SequenceContext =>
  sequenceContext(input.rows, input.condition, input.routines, input.ranges);

export function whoOptions(input: RefOptionsInput): WhoOption[] {
  const self: WhoOption = { kind: "self", label: SelfLabel, max: null };
  if (input.from === null) {
    return [self, { kind: "partner", label: PartnerLabel, max: null }, { kind: "seat", label: SeatLabel, max: null }];
  }
  const ctx = context(input);
  const band = bandAt(ctx.bands, input.from);
  if (!band) return [self];
  const step = ctx.steps.find((s) => s.position === input.from);
  const routine = step && ctx.routines.find((r) => r.name === step.routine);
  return [
    self,
    { kind: "partner", label: PartnerLabel, max: groupSizeAt(band, routine) - 1 },
    { kind: "seat", label: SeatLabel, max: band.cohortSize },
  ];
}

function option(value: RefWhere, label: string, input: RefOptionsInput, ctx: SequenceContext, fallback: Step[]): WhereOption {
  if (input.from === null) return { value, label, disabledReason: null, targets: fallback };
  const safety = refSafety(value, input.from, ctx);
  return safety.ok
    ? { value, label, disabledReason: null, targets: safety.targets }
    : { value, label, disabledReason: safety.message, targets: fallback };
}

export function whereOptions(input: RefOptionsInput): { byStep: WhereOption[]; byTrial: WhereOption[] } {
  const ctx = context(input);
  // Every step is listed, later ones included: spec §7.2 greys an unsafe
  // entry with its reason rather than hiding it, so the experimenter sees why.
  const byStep = ctx.steps.map((s) =>
    option({ kind: "position", n: s.position }, `p${s.position} · t${s.trial} · ${s.routine}`, input, ctx, [s]),
  );

  const byTrial: WhereOption[] = [];
  const trials = [...new Set(ctx.steps.map((s) => s.trial))].sort((a, b) => a - b);
  for (const k of trials) {
    const members = ctx.steps.filter((s) => s.trial === k);
    const names = [...new Set(members.map((s) => s.routine))];
    byTrial.push(option({ kind: "trial", k }, `t${k} · ${names.join(", ")}`, input, ctx, members));
    if (names.length > 1) {
      for (const name of names) {
        byTrial.push(option({ kind: "trial", k, routine: name }, `t${k}:${name}`, input, ctx, members.filter((m) => m.routine === name)));
      }
    }
  }
  return { byStep, byTrial };
}

function surveyQuestionNames(params: Record<string, unknown>): string[] {
  const json = params.surveyJson as { pages?: { elements?: { name?: string }[] }[]; elements?: { name?: string }[] } | undefined;
  const groups = [...(json?.pages ?? []).map((p) => p.elements ?? []), json?.elements ?? []];
  return groups.flat().flatMap((q) => (typeof q.name === "string" ? [q.name] : []));
}

function fieldsFor(element: { type: ElementType; params: unknown }): FieldOption[] {
  const named = (values: string[]): FieldOption[] => values.map((v) => ({ value: v, label: v }));
  if (element.type === "survey") return named(surveyQuestionNames(element.params as Record<string, unknown>));
  if (element.type === "video-chat") {
    const kind = elementRefKind({ type: element.type, params: element.params as VideoChatParams });
    return named(kind === "media" ? UploadFields : [TranscriptTextField]);
  }
  if (element.type === "input-file-picker") return named(FilePickerFields);
  if (UploadProducers.has(element.type)) return named(UploadFields);
  return [];
}

export function elementOptions(targets: Step[], routines: RoutineConfig[], kind: RefKind | null): ElementOption[] {
  return elementsAvailable(targets, routines, kind).map((element) => ({
    name: element.name,
    type: element.type,
    // elementsAvailable returns producers only, so elementRefKind is never null here.
    kind: elementRefKind(element)!,
    fields: fieldsFor(element),
  }));
}

export function buildRef(who: string, where: RefWhere, element: string, field?: string): string | null {
  const parsedWho = parseParticipantRef(who);
  if (!parsedWho) return null;
  return formatRef({ who: parsedWho, where, element, ...(field ? { field } : {}) });
}
