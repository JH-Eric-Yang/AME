/**
 * progressSteps — editing one condition's sequence of steps.
 *
 * Every operation returns new rows (never mutates), renumbers the condition's
 * steps to 0..n-1, and rewrites `p<N>` references through the resulting
 * position map so a ref keeps pointing at the same step. Other conditions'
 * rows pass through untouched: each condition owns its own sequence.
 */

import type { RoutineConfig } from "ame-shared";
import { stepsFor, type SequenceRow } from "ame-shared/progressSequence";
import { findRefs, remapPositionRefs, formatRef, isRef, parseRef } from "ame-shared/refs";

export interface EditResult {
  rows: SequenceRow[];
  /** Old position → new position for every step that survived. */
  positionMap: Map<number, number>;
  /** Position refs whose number changed. */
  rewritten: number;
}

export interface Dependant {
  /** The referring step's position, or -1 for a routine default. */
  position: number;
  /** The element's name, qualified as `<routine>/<element>` for a routine default. */
  element: string;
  ref: string;
}

/** The delivered row plus any extra-trial rows at one progress. */
type StepRows = SequenceRow[];

export function newRow(condition: string, position: number, routine: string): SequenceRow {
  return { progress: position, trialNumber: 1, routine, condition, content: {}, description: null };
}

/** The condition's steps as row groups, in sequence order. */
function groups(rows: SequenceRow[], condition: string): StepRows[] {
  return stepsFor(rows, condition).map((step) => [rows[step.rowIndex], ...step.extraRowIndices.map((i) => rows[i])]);
}

const positionRefsIn = (content: unknown): number[] =>
  findRefs(content).flatMap((ref) => (ref.where.kind === "position" ? [ref.where.n] : []));

/**
 * A `showWhen` filter's `property` is compared whole, never as a `{{ }}`
 * template (`findRefSites` in `refValidation.ts` makes the same distinction),
 * so only a property that is itself a whole ref counts as a step reference —
 * one embedded in a template string is left alone here.
 */
const positionRefInProperty = (property: string): number[] => {
  if (!isRef(property)) return [];
  const parsed = parseRef(property);
  return parsed && parsed.where.kind === "position" ? [parsed.where.n] : [];
};

/**
 * Lay `ordered` groups out at 0..n-1, rewrite refs in this condition's rows
 * through the resulting map, and put the other conditions' rows back where
 * they were.
 */
function commit(rows: SequenceRow[], condition: string, ordered: StepRows[]): EditResult {
  const positionMap = new Map<number, number>();
  const mappings: Array<[number, number]> = [];
  ordered.forEach((group, index) => {
    if (group[0].progress >= 0 && group[0].condition === condition) {
      mappings.push([group[0].progress, index]);
    }
  });
  // Sort by old position to maintain consistent iteration order
  mappings.sort((a, b) => a[0] - b[0]);
  for (const [oldPos, newPos] of mappings) {
    positionMap.set(oldPos, newPos);
  }
  const map = (n: number): number => positionMap.get(n) ?? n;

  let rewritten = 0;
  const renumbered = ordered.flatMap((group, index) =>
    group.map((r) => {
      rewritten += positionRefsIn(r.content).filter((n) => map(n) !== n).length;
      return { ...r, progress: index, content: remapPositionRefs(r.content, map) };
    }),
  );
  const others = rows.filter((r) => r.condition !== condition);
  return { rows: [...renumbered, ...others], positionMap, rewritten };
}

export function insertStep(rows: SequenceRow[], condition: string, at: number, routine: string): EditResult {
  const ordered = groups(rows, condition);
  // A fresh row carries progress -1 so `commit` never maps it as a surviving position.
  ordered.splice(at, 0, [{ ...newRow(condition, -1, routine) }]);
  return commit(rows, condition, ordered);
}

/** The most steps one "Add trials from stimuli" action may add; a longer list is almost surely a paste error. */
export const MaxTrialsPerInsert = 500;

export interface TrialTargetRef {
  routine: string;
  element: string;
  param: string;
}

export interface TrialsResult extends EditResult {
  /** The trial numbers the new steps carry, for the randomization notice. */
  trials: { from: number; to: number };
}

/**
 * One new step per value, each overriding only `target`. Each step gets its own
 * trial number above the condition's highest: the runtime moves rows that share
 * a trial number as one unit, and a randomization range selects trial numbers.
 */
export function insertTrials(
  rows: SequenceRow[], condition: string, at: number, target: TrialTargetRef, values: unknown[],
): TrialsResult {
  const ordered = groups(rows, condition);
  const highest = Math.max(0, ...rows.filter((r) => r.condition === condition).map((r) => r.trialNumber));
  const fresh = values.map((value, i): StepRows => [{
    ...newRow(condition, -1, target.routine),
    trialNumber: highest + 1 + i,
    content: { [target.element]: { [target.param]: value } },
  }]);
  ordered.splice(at, 0, ...fresh);
  return { ...commit(rows, condition, ordered), trials: { from: highest + 1, to: highest + values.length } };
}

/**
 * Everything that would dangle if `position` were removed: this condition's
 * content overrides and, when `routines` is given, the routine defaults behind
 * them — the runtime resolves both against the same positions, so a default is
 * as much a dependant as an override.
 */
export function dependantsOf(
  rows: SequenceRow[],
  condition: string,
  position: number,
  routines: RoutineConfig[] = [],
): Dependant[] {
  const out: Dependant[] = [];
  const refsTo = (params: unknown): string[] =>
    findRefs(params).flatMap((ref) =>
      ref.where.kind === "position" && ref.where.n === position ? [formatRef(ref)] : [],
    );
  const propertyRefsTo = (properties: string[]): string[] =>
    properties.flatMap((property) => {
      if (!isRef(property)) return [];
      const parsed = parseRef(property);
      return parsed && parsed.where.kind === "position" && parsed.where.n === position ? [formatRef(parsed)] : [];
    });

  for (const r of rows) {
    if (r.condition !== condition) continue;
    for (const [element, params] of Object.entries(r.content)) {
      for (const ref of refsTo(params)) out.push({ position: r.progress, element, ref });
    }
  }
  for (const routine of routines) {
    for (const element of routine.elements) {
      for (const ref of [...refsTo(element.params), ...propertyRefsTo((element.showWhen ?? []).map((filter) => filter.property))]) {
        out.push({ position: -1, element: `${routine.name}/${element.name}`, ref });
      }
    }
  }
  return out;
}

export function deleteStep(
  rows: SequenceRow[],
  condition: string,
  position: number,
  routines: RoutineConfig[] = [],
): EditResult | { refused: Dependant[] } {
  const refused = dependantsOf(rows, condition, position, routines);
  if (refused.length > 0) return { refused };
  const ordered = groups(rows, condition).filter((group) => group[0].progress !== position);
  return commit(rows, condition, ordered);
}

export function moveStep(rows: SequenceRow[], condition: string, from: number, to: number): EditResult {
  const ordered = groups(rows, condition);
  const fromIndex = ordered.findIndex((g) => g[0].progress === from);
  const toIndex = ordered.findIndex((g) => g[0].progress === to);
  if (fromIndex < 0 || toIndex < 0) return commit(rows, condition, ordered);
  const [group] = ordered.splice(fromIndex, 1);
  ordered.splice(toIndex, 0, group);
  return commit(rows, condition, ordered);
}

export function duplicateStep(rows: SequenceRow[], condition: string, position: number): EditResult {
  const ordered = groups(rows, condition);
  const index = ordered.findIndex((g) => g[0].progress === position);
  if (index < 0) return commit(rows, condition, ordered);
  const copy = ordered[index].map((r) => ({ ...structuredClone(r), progress: -1, description: null }));
  ordered.splice(index + 1, 0, copy);
  return commit(rows, condition, ordered);
}

export function changeRoutine(
  rows: SequenceRow[],
  condition: string,
  position: number,
  routine: RoutineConfig,
): SequenceRow[] {
  const keep = new Set(routine.elements.map((e) => e.name));
  return rows.map((r) => {
    if (r.condition !== condition || r.progress !== position) return r;
    const content = Object.fromEntries(Object.entries(r.content).filter(([name]) => keep.has(name)));
    return { ...r, routine: routine.name, content };
  });
}

export function renumber(rows: SequenceRow[], condition: string): EditResult {
  return commit(rows, condition, groups(rows, condition));
}

/** `affected` names the routines whose defaults changed, for the tab's report. */
export function remapRoutineRefs(
  routines: RoutineConfig[],
  positionMap: Map<number, number>,
): { routines: RoutineConfig[]; rewritten: number; affected: string[] } {
  const map = (n: number): number => positionMap.get(n) ?? n;
  let rewritten = 0;
  const affected: string[] = [];
  const out = routines.map((routine) => {
    const before = rewritten;
    const elements = routine.elements.map((element) => {
      const positions = [
        ...positionRefsIn(element.params),
        ...(element.showWhen ?? []).flatMap((filter) => positionRefInProperty(filter.property)),
      ];
      rewritten += positions.filter((n) => map(n) !== n).length;
      return {
        ...element,
        params: remapPositionRefs(element.params, map),
        // A condition's property can reference a step too (Phase 4), but only
        // when the whole property is a ref — a template embedded in it is left as authored.
        ...(element.showWhen
          ? { showWhen: element.showWhen.map((filter) => ({ ...filter, property: isRef(filter.property) ? remapPositionRefs(filter.property, map) : filter.property })) }
          : {}),
      };
    });
    if (rewritten > before) affected.push(routine.name);
    return { ...routine, elements };
  });
  return { routines: out, rewritten, affected };
}
