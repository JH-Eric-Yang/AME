/**
 * progressSequence — one condition's content rows as the runtime sees them:
 * a list of steps (one per progress), the matching bands that span them, and
 * the randomization ranges that may shuffle them.
 *
 * Shared by reference validation (which must reason about what can run where)
 * and the Progress tab (which draws the same bands and ranges). Pure.
 *
 * Contiguity invariant: a `p<N>` ref resolves at runtime against
 * `ExperimentResult.progress` — the virtual index of the delivered sequence —
 * which coincides with a content row's `progress` only while a condition's
 * positions are 0-based and contiguous. The Progress tab normalises to that on
 * every structural edit; a legacy gappy sequence is left as authored until the
 * first such edit, and `contentValidation` warns about it in the meantime.
 */

import type { InteractionPattern, RandomizationRange, RoutineConfig } from "./types.js";
import { GeneratedDescriptionPrefix } from "./generatedRows.js";

/** A content row as `listContent` returns it, minus ids. */
export interface SequenceRow {
  progress: number;
  trialNumber: number;
  routine: string;
  condition: string;
  content: Record<string, unknown>;
  description?: string | null;
}

/** One position of a condition's sequence: the row the runtime will deliver there. */
export interface Step {
  /** The row's `progress` — the runtime's 0-based position. */
  position: number;
  /** The delivered row's `trialNumber`. */
  trial: number;
  routine: string;
  /** Index into the rows array `stepsFor` was given (all conditions). */
  rowIndex: number;
  /** Other rows at this progress; the runtime never delivers them. */
  extraRowIndices: number[];
  /** Compiled by a Session Design block; edited through the Session tab. */
  generated: boolean;
}

/** A routine-matching → routine-end-matching span, positions inclusive. */
export interface Band {
  from: number;
  to: number;
  matchRoutine: string;
  cohortSize: number;
  /** Members per interaction group at a step, from the band's pattern. */
  groupSize: number;
  pattern: InteractionPattern | null;
}

/** A randomization range projected onto positions. */
export interface ShuffledRange {
  from: number;
  to: number;
  positions: number[];
  trials: number[];
  method: RandomizationRange["method"];
}

const byProgressThenTrial = (a: SequenceRow, b: SequenceRow): number =>
  a.progress - b.progress || a.trialNumber - b.trialNumber;

export function stepsFor(rows: SequenceRow[], condition: string): Step[] {
  const indexed = rows
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => row.condition === condition)
    .sort((a, b) => byProgressThenTrial(a.row, b.row));

  const steps: Step[] = [];
  for (const { row, rowIndex } of indexed) {
    const last = steps[steps.length - 1];
    if (last && last.position === row.progress) {
      last.extraRowIndices.push(rowIndex);
      continue;
    }
    steps.push({
      position: row.progress,
      trial: row.trialNumber,
      routine: row.routine,
      rowIndex,
      extraRowIndices: [],
      generated: typeof row.description === "string" && row.description.startsWith(GeneratedDescriptionPrefix),
    });
  }
  return steps;
}

/** How many members share one interaction group under `pattern`, or `cohortSize` when it is not group-shaped. */
function patternGroupSize(pattern: InteractionPattern | null | undefined, cohortSize: number): number {
  if (!pattern) return cohortSize;
  switch (pattern.type) {
    case "round-robin":
      return pattern.groupSize;
    case "fixed":
      return Math.max(0, ...pattern.groups.map((g) => g.length));
    case "sequence":
      return Math.max(0, ...pattern.steps.flatMap((step) => step.map((g) => g.length)));
    case "all":
      return cohortSize;
  }
}

const closesBand = (routine: RoutineConfig): boolean =>
  routine.type === "routine-end-matching" || routine.type === "routine-end";

export function matchingBands(steps: Step[], routines: RoutineConfig[]): Band[] {
  const byName = new Map(routines.map((r) => [r.name, r]));
  const bands: Band[] = [];
  let open: { from: number; matchRoutine: string; cohortSize: number; pattern: InteractionPattern | null } | null = null;

  for (const step of steps) {
    const routine = byName.get(step.routine);
    if (!routine) continue;

    if (!open && routine.matching) {
      open = { from: step.position, matchRoutine: routine.name, cohortSize: routine.matching.slots.length, pattern: routine.interactionPattern ?? null };
      continue;
    }
    if (!open) continue;

    if (!open.pattern && routine.interactionPattern) open.pattern = routine.interactionPattern;
    if (closesBand(routine)) {
      bands.push(finishBand(open, step.position));
      open = null;
    }
  }

  if (open && steps.length > 0) bands.push(finishBand(open, steps[steps.length - 1].position));
  return bands;
}

function finishBand(
  open: { from: number; matchRoutine: string; cohortSize: number; pattern: InteractionPattern | null },
  to: number,
): Band {
  return {
    from: open.from,
    to,
    matchRoutine: open.matchRoutine,
    cohortSize: open.cohortSize,
    groupSize: patternGroupSize(open.pattern, open.cohortSize),
    pattern: open.pattern,
  };
}

export function shuffledRanges(steps: Step[], ranges: RandomizationRange[]): ShuffledRange[] {
  const out: ShuffledRange[] = [];
  for (const range of ranges) {
    const inRange = steps.filter((s) => s.trial >= range.fromTrial && s.trial <= range.toTrial);
    if (inRange.length === 0) continue;
    const positions = inRange.map((s) => s.position);
    out.push({
      from: Math.min(...positions),
      to: Math.max(...positions),
      positions,
      trials: [...new Set(inRange.map((s) => s.trial))],
      method: range.method,
    });
  }
  return out;
}

export function bandAt(bands: Band[], position: number): Band | null {
  return bands.find((b) => position >= b.from && position <= b.to) ?? null;
}

export function rangeAt(ranges: ShuffledRange[], position: number): ShuffledRange | null {
  return ranges.find((r) => r.positions.includes(position)) ?? null;
}

/** Interaction-group size at a step: the routine's own pattern wins over the band's. */
export function groupSizeAt(band: Band, routine: RoutineConfig | undefined): number {
  return routine?.interactionPattern
    ? patternGroupSize(routine.interactionPattern, band.cohortSize)
    : band.groupSize;
}
