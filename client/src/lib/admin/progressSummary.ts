/**
 * progressSummary — what a step produces (elements a later step can
 * reference) and what it consumes (the refs in its params). The step cards
 * and the ReferencePicker's element list both read `producersOf`, so the two
 * cannot disagree about what is referenceable.
 */

import type { ElementType, RoutineConfig } from "ame-shared";
import { formatParticipantRef, type ParsedRef, type RefKind } from "ame-shared/refs";
import { findRefSites } from "ame-shared/refValidation";
import { elementRefKind, referableElements } from "ame-shared/producers";

export interface Producer {
  element: string;
  type: ElementType;
  kind: RefKind;
}

export interface Consumed {
  ref: string;
  parsed: ParsedRef | null;
  element: string;
}

/** Separates the element name from the raw ref in the dedupe key; neither can contain it. */
const KeySeparator = "|";
const RefSeparator = " / ";

export function producersOf(routine: RoutineConfig): Producer[] {
  return referableElements(routine.elements).flatMap((element) => {
    const kind = elementRefKind(element);
    return kind ? [{ element: element.name, type: element.type, kind }] : [];
  });
}

export function consumersOf(routine: RoutineConfig, content: Record<string, unknown>): Consumed[] {
  const seen = new Set<string>();
  return findRefSites(routine.elements, content).flatMap((site) => {
    const key = `${site.element}${KeySeparator}${site.raw}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ ref: site.raw, parsed: site.parsed, element: site.element }];
  });
}

export function describeRef(ref: ParsedRef): string {
  const where = ref.where.kind === "position"
    ? `p${ref.where.n}`
    : ref.where.routine ? `t${ref.where.k}:${ref.where.routine}` : `t${ref.where.k}`;
  const element = ref.field ? `${ref.element}.${ref.field}` : ref.element;
  return [formatParticipantRef(ref.who), where, element].join(RefSeparator);
}
