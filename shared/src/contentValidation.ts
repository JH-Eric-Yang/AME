import type { RandomizationConfig, RoutineConfig, RoutineType } from "./types.js";
import { GeneratedDescriptionPrefix, isGeneratedRow } from "./generatedRows.js";
import { sequenceContext, validateStepRefs } from "./refValidation.js";
import type { SequenceRow } from "./progressSequence.js";

/** One content row as the admin Content tab holds it, before upload. */
export interface ContentValidationRow {
  progress: number;
  trialNumber: number;
  routine: string;
  condition: string;
  content: Record<string, unknown>;
  description?: string | null;
}

/** A warning about a whole condition's progress sequence rather than one row. */
export interface StructuralWarning {
  condition: string;
  message: string;
}

export interface ContentValidationResult {
  /** Index-parallel to the rows passed in: `rowWarnings[i]` belongs to `rows[i]`. */
  rowWarnings: string[][];
  /** Hard failures, same shape. A save carrying any of these is refused. */
  rowErrors: string[][];
  structuralWarnings: StructuralWarning[];
}

/** The condition every row falls back to when an experiment declares none. */
const DefaultCondition = "Basic";

/**
 * The one hard failure in this module.
 *
 * Every other finding here is a warning on purpose — content is researcher
 * data and a half-authored table must still be savable. These are different:
 * a row with no `progress` or no `routine` is not half-authored, it is a row
 * the columns cannot hold. Prisma rejects it inside `createMany`, and on the
 * server that rejection surfaces in an async Express handler with no error
 * middleware behind it, so the request is never answered and the unhandled
 * rejection takes the process down mid-experiment.
 *
 * @param rows the raw `rows` value off a content write request.
 * @returns null when every row is writable, otherwise why the first bad one
 *   is not, naming its 1-based position so the researcher can find it.
 */
export function contentRowShapeIssue(rows: unknown[]): string | null {
  for (const [index, row] of rows.entries()) {
    const position = index + 1;
    if (!row || typeof row !== "object") {
      return `Row ${position} is not a content row object`;
    }

    const { progress, trialNumber, routine, content, condition, description } =
      row as Record<string, unknown>;

    if (!Number.isInteger(progress)) {
      return `Row ${position} needs a whole-number progress; it carries ${JSON.stringify(progress)}`;
    }
    if (typeof routine !== "string" || routine.length === 0) {
      return `Row ${position} needs the name of the routine it drives; it carries ${JSON.stringify(routine)}`;
    }
    if (trialNumber !== undefined && !Number.isInteger(trialNumber)) {
      return `Row ${position} needs a whole-number trialNumber; it carries ${JSON.stringify(trialNumber)}`;
    }
    // Undefined is allowed and defaults to `{}` on the way in; null and scalars
    // are not, because the column is a non-nullable Json object.
    if (content !== undefined && (content === null || typeof content !== "object")) {
      return `Row ${position} needs its content to be an object; it carries ${JSON.stringify(content)}`;
    }
    if (condition !== undefined && typeof condition !== "string") {
      return `Row ${position} needs its condition to be a name; it carries ${JSON.stringify(condition)}`;
    }
    if (description != null && typeof description !== "string") {
      return `Row ${position} needs its description to be text; it carries ${JSON.stringify(description)}`;
    }
  }

  return null;
}

interface ProgressEntry {
  types: Set<RoutineType>;
  rowIndices: number[];
  roundRobinRowIndices: number[];
}

const rowKey = (row: ContentValidationRow): string =>
  `${row.progress}:${row.trialNumber}:${row.condition}`;

const indexRoutines = (routines: RoutineConfig[]): Map<string, RoutineConfig> =>
  new Map(routines.map((routine) => [routine.name, routine]));

const rotatesPartners = (routine: RoutineConfig | undefined): boolean =>
  routine?.interactionPattern?.type === "round-robin";

/**
 * For each progress, whether a matching band is open while it runs. A
 * `routine-matching` at the same progress counts as already open; a
 * `routine-end-matching` at the same progress closes it only for later ones.
 */
function bandOpenByProgress(
  progressValues: number[],
  progressMap: Map<number, ProgressEntry>,
): Map<number, boolean> {
  const openAt = new Map<number, boolean>();
  let open = false;
  for (const progress of progressValues) {
    const { types } = progressMap.get(progress)!;
    if (types.has("routine-matching")) open = true;
    openAt.set(progress, open);
    if (types.has("routine-end-matching")) open = false;
  }
  return openAt;
}

/**
 * For each progress, whether the band it sits in is later closed by a
 * `routine-end-matching` before any further `routine-matching` opens a new one.
 */
function bandClosesByProgress(
  progressValues: number[],
  progressMap: Map<number, ProgressEntry>,
): Map<number, boolean> {
  const closesAt = new Map<number, boolean>();
  let closes = false;
  for (let i = progressValues.length - 1; i >= 0; i--) {
    const progress = progressValues[i];
    const { types } = progressMap.get(progress)!;
    if (types.has("routine-end-matching")) closes = true;
    closesAt.set(progress, closes);
    if (types.has("routine-matching")) closes = false;
  }
  return closesAt;
}

/**
 * Validate each condition's progress sequence:
 * 1. The last progress must use a `routine-end`.
 * 2. Every `routine-video-chat` needs a `routine-matching` before it and a
 *    `routine-end-matching` after it.
 * 3. Every routine whose `interactionPattern` is round-robin must sit inside
 *    such a band, or its rotation index never advances.
 * 4. The positions must be 0-based and contiguous, since the runtime walks
 *    them in order and stops at the first missing one.
 */
function validateStructure(
  rows: ContentValidationRow[],
  routines: RoutineConfig[],
): Pick<ContentValidationResult, "rowWarnings" | "structuralWarnings"> {
  const byName = indexRoutines(routines);
  const rowWarnings: string[][] = rows.map(() => []);
  const structuralWarnings: StructuralWarning[] = [];

  const indicesByCondition = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const indices = indicesByCondition.get(row.condition) ?? [];
    indices.push(index);
    indicesByCondition.set(row.condition, indices);
  });

  for (const [condition, indices] of indicesByCondition) {
    const progressMap = new Map<number, ProgressEntry>();
    for (const index of indices) {
      const row = rows[index];
      let entry = progressMap.get(row.progress);
      if (!entry) {
        entry = { types: new Set<RoutineType>(), rowIndices: [], roundRobinRowIndices: [] };
        progressMap.set(row.progress, entry);
      }
      entry.rowIndices.push(index);
      const routine = byName.get(row.routine);
      if (!routine) continue;
      entry.types.add(routine.type);
      if (rotatesPartners(routine)) entry.roundRobinRowIndices.push(index);
    }

    const progressValues = [...progressMap.keys()].sort((a, b) => a - b);
    if (progressValues.length === 0) continue;

    // 1. The experiment must end somewhere.
    const lastProgress = progressValues[progressValues.length - 1];
    const lastEntry = progressMap.get(lastProgress)!;
    if (!lastEntry.types.has("routine-end")) {
      structuralWarnings.push({
        condition,
        message: `Condition "${condition}": last progress (${lastProgress}) should use a routine-end to mark the end of the experiment`,
      });
      for (const index of lastEntry.rowIndices) {
        rowWarnings[index].push("Last progress should use a routine-end routine");
      }
    }

    // 2. Video chat needs a matching band around it.
    progressValues.forEach((progress, position) => {
      const entry = progressMap.get(progress)!;
      if (!entry.types.has("routine-video-chat")) return;

      const videoChatRows = entry.rowIndices.filter(
        (index) => byName.get(rows[index].routine)?.type === "routine-video-chat",
      );
      const openedEarlier = progressValues
        .slice(0, position)
        .some((p) => progressMap.get(p)!.types.has("routine-matching"));
      const closedLater = progressValues
        .slice(position + 1)
        .some((p) => progressMap.get(p)!.types.has("routine-end-matching"));

      if (!openedEarlier) {
        structuralWarnings.push({
          condition,
          message: `Condition "${condition}": routine-video-chat at progress ${progress} needs a routine-matching at an earlier progress`,
        });
        for (const index of videoChatRows) {
          rowWarnings[index].push("Missing routine-matching before this video-chat");
        }
      }
      if (!closedLater) {
        structuralWarnings.push({
          condition,
          message: `Condition "${condition}": routine-video-chat at progress ${progress} needs a routine-end-matching at a later progress`,
        });
        for (const index of videoChatRows) {
          rowWarnings[index].push("Missing routine-end-matching after this video-chat");
        }
      }
    });

    // 3. A rotation only advances inside a band: the rotation index is
    //    session-scoped, and a routine outside one has no session to count in.
    const openAt = bandOpenByProgress(progressValues, progressMap);
    const closesAt = bandClosesByProgress(progressValues, progressMap);
    for (const progress of progressValues) {
      const entry = progressMap.get(progress)!;
      if (entry.roundRobinRowIndices.length === 0) continue;
      if (openAt.get(progress) && closesAt.get(progress)) continue;

      for (const index of entry.roundRobinRowIndices) {
        structuralWarnings.push({
          condition,
          message: `Condition "${condition}": routine "${rows[index].routine}" rotates partners at progress ${progress}, which is not inside a routine-matching → routine-end-matching band; the rotation index stays 0 and every trial repeats the first pairing`,
        });
        rowWarnings[index].push("Round-robin rotation outside a routine-matching band");
      }
    }

    // 4. `p<N>` and the runtime's own index are the same number only while the
    //    positions run 0..n-1. The warning sits on the condition's first row
    //    because it is about the sequence, not about any one step; the Progress
    //    tab renumbers on its next structural edit.
    if (progressValues.some((progress, position) => progress !== position)) {
      rowWarnings[indices[0]].push(
        `Condition "${condition}": steps are numbered ${progressValues.join(", ")}; the runtime delivers positions 0..${progressValues.length - 1} in order, so a gap ends the experiment early`,
      );
    }
  }

  return { rowWarnings, structuralWarnings };
}

/**
 * Reference and extra-trial findings, per condition. Errors are the §4 hard
 * rules; a step's issues land on the row the runtime would deliver there,
 * and each extra row at the same progress gets its own "never runs" warning.
 */
function validateReferences(
  rows: ContentValidationRow[],
  routines: RoutineConfig[],
  conditions: Set<string>,
  randomizationConfig: RandomizationConfig | null | undefined,
): { errors: string[][]; warnings: string[][] } {
  const errors: string[][] = rows.map(() => []);
  const warnings: string[][] = rows.map(() => []);
  const sequenceRows = rows as SequenceRow[];

  for (const condition of conditions) {
    const ctx = sequenceContext(sequenceRows, condition, routines, randomizationConfig?.[condition] ?? []);
    for (const step of ctx.steps) {
      for (const issue of validateStepRefs(step, sequenceRows, ctx)) {
        (issue.level === "error" ? errors : warnings)[step.rowIndex].push(issue.message);
      }
      for (const extra of step.extraRowIndices) {
        warnings[extra].push(
          `Only the lowest trial (t${step.trial}) at progress ${step.position} is delivered; this row never runs`,
        );
      }
    }
  }
  return { errors, warnings };
}

/**
 * Validate content rows against the experiment's routines and conditions.
 * Structural and per-row findings are warnings, never a hard failure: content
 * is researcher data, and a half-authored table must still be viewable and
 * savable. Reference findings (spec §4) can be errors, which a save refuses.
 */
export function validateContentRows(
  rows: ContentValidationRow[],
  routines: RoutineConfig[],
  conditions: string[],
  randomizationConfig?: RandomizationConfig | null,
): ContentValidationResult {
  const byName = indexRoutines(routines);
  const conditionNames = new Set(conditions.length > 0 ? conditions : [DefaultCondition]);
  conditionNames.add(DefaultCondition);

  const { rowWarnings: structuralRowWarnings, structuralWarnings } = validateStructure(rows, routines);
  const refs = validateReferences(rows, routines, new Set(rows.map((r) => r.condition)), randomizationConfig);

  const occurrences = new Map<string, number>();
  for (const row of rows) {
    const key = rowKey(row);
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
  }

  const rowWarnings = rows.map((row, index) => {
    const warnings: string[] = [];

    if (row.routine === "") {
      warnings.push("Routine is required");
    } else if (!byName.has(row.routine)) {
      warnings.push(`Routine "${row.routine}" not found in experiment`);
    }

    if (!Number.isInteger(row.progress) || row.progress < 0) {
      warnings.push(`Progress ${row.progress} must be a non-negative whole number`);
    }
    if (!Number.isInteger(row.trialNumber) || row.trialNumber < 1) {
      warnings.push(`Trial number ${row.trialNumber} must be 1 or greater`);
    }
    if (!conditionNames.has(row.condition)) {
      warnings.push(`Condition "${row.condition}" not found in experiment`);
    }

    const routine = byName.get(row.routine);
    if (routine) {
      const elementNames = new Set(routine.elements.map((element) => element.name));
      const unknownKeys = Object.keys(row.content).filter((key) => !elementNames.has(key));
      if (unknownKeys.length > 0) {
        warnings.push(`Unknown content keys: ${unknownKeys.join(", ")}`);
      }
    }

    if ((occurrences.get(rowKey(row)) ?? 0) > 1) {
      warnings.push("Duplicate: same progress, trial and condition as another row");
    }

    warnings.push(...structuralRowWarnings[index]);
    warnings.push(...refs.warnings[index]);
    return warnings;
  });

  return { rowWarnings, rowErrors: refs.errors, structuralWarnings };
}

export { GeneratedDescriptionPrefix, isGeneratedRow } from "./generatedRows.js";
