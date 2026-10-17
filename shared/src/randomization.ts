import type { RandomizationRange, RoutineConfig, MatchingPeriod } from "./types.js";

interface TrialGroup {
  trialNumber: number;
  progressNumbers: number[];
}

/**
 * Build a progress sequence mapping virtual progress to content progress.
 * Trial groups (content rows sharing a trial number) are randomized as atomic units.
 */
export function buildProgressSequence(
  contentRows: { progress: number; trialNumber: number }[],
  ranges: RandomizationRange[],
  participantIndex: number,
): number[] {
  if (contentRows.length === 0) return [];

  const trialMap = new Map<number, number[]>();
  for (const row of contentRows) {
    if (!trialMap.has(row.trialNumber)) {
      trialMap.set(row.trialNumber, []);
    }
    trialMap.get(row.trialNumber)!.push(row.progress);
  }

  const trialGroups: TrialGroup[] = [];
  for (const [trialNumber, progressNumbers] of trialMap) {
    trialGroups.push({
      trialNumber,
      progressNumbers: progressNumbers.sort((a, b) => a - b),
    });
  }
  trialGroups.sort((a, b) => a.progressNumbers[0] - b.progressNumbers[0]);

  const ordered = [...trialGroups];
  for (const range of ranges) {
    const inRangeIndices: number[] = [];
    const inRange: TrialGroup[] = [];
    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i].trialNumber >= range.fromTrial && ordered[i].trialNumber <= range.toTrial) {
        inRangeIndices.push(i);
        inRange.push(ordered[i]);
      }
    }
    if (inRange.length === 0) continue;

    let reordered: TrialGroup[];
    switch (range.method) {
      case "shuffle":
        reordered = fisherYatesShuffle([...inRange]);
        break;
      case "latin-square":
        reordered = latinSquareOrder(inRange, participantIndex);
        break;
      case "block":
        reordered = blockRandomize(inRange, range.blockSize ?? inRange.length);
        break;
    }

    for (let i = 0; i < inRangeIndices.length; i++) {
      ordered[inRangeIndices[i]] = reordered[i];
    }
  }

  return ordered.flatMap((tg) => tg.progressNumbers);
}

/** Fisher-Yates shuffle (in-place). */
function fisherYatesShuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Latin square: circular shift. Row i shifts the array by i positions. */
function latinSquareOrder(groups: TrialGroup[], participantIndex: number): TrialGroup[] {
  const n = groups.length;
  if (n === 0) return groups;
  const row = participantIndex % n;
  return groups.map((_, i) => groups[(i + row) % n]);
}

/** Block randomization: divide into blocks of blockSize, shuffle within each. */
function blockRandomize(groups: TrialGroup[], blockSize: number): TrialGroup[] {
  const result: TrialGroup[] = [];
  for (let i = 0; i < groups.length; i += blockSize) {
    const block = groups.slice(i, i + blockSize);
    result.push(...fisherYatesShuffle(block));
  }
  return result;
}

/**
 * Detect matching periods from content rows and routine templates.
 * A matching period starts at a routine with matching config and ends at
 * a routine-end-matching or routine-end type (or the last content row if unclosed).
 */
export function detectMatchingPeriods(
  contentRows: { progress: number; routine: string }[],
  routineTemplates: RoutineConfig[],
): MatchingPeriod[] {
  const periods: MatchingPeriod[] = [];
  let currentStart: number | null = null;

  const templateMap = new Map(routineTemplates.map((r) => [r.name, r]));

  for (const row of contentRows) {
    const template = templateMap.get(row.routine);
    if (!template) continue;

    const isMatchingStart = template.matching != null && currentStart === null;
    const isMatchingEnd =
      (template.type === "routine-end-matching" || template.type === "routine-end") &&
      currentStart !== null;

    if (isMatchingStart) {
      currentStart = row.progress;
    } else if (isMatchingEnd) {
      periods.push({ fromProgress: currentStart!, toProgress: row.progress });
      currentStart = null;
    }
  }

  if (currentStart !== null && contentRows.length > 0) {
    periods.push({
      fromProgress: currentStart,
      toProgress: contentRows[contentRows.length - 1].progress,
    });
  }

  return periods;
}
