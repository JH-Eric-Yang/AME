import type { InteractionPattern, RoutineConfig } from "./types.js";

/**
 * Compute all round-robin rotations for N seats with groups of M.
 * Uses the circle method: fix seat 0, rotate the rest, then pair/group.
 * Returns seatCount-1 unique rotations.
 */
export function computeRoundRobinRotations(
  seatCount: number,
  groupSize: number,
): number[][][] {
  if (seatCount < 2 || groupSize < 1 || seatCount % groupSize !== 0) {
    return [[Array.from({ length: seatCount }, (_, i) => i)]];
  }

  const others = Array.from({ length: seatCount - 1 }, (_, i) => i + 1);
  const numRotations = seatCount - 1;
  const rotations: number[][][] = [];

  for (let r = 0; r < numRotations; r++) {
    const rotated = rotateArray(others, r);
    const full = [0, ...rotated];
    const groups: number[][] = [];

    if (groupSize === 2) {
      // Mirror pairing: pair index i with index (n-1-i) for optimal coverage
      for (let i = 0; i < seatCount / 2; i++) {
        groups.push([full[i], full[seatCount - 1 - i]].sort((a, b) => a - b));
      }
    } else {
      const numGroups = seatCount / groupSize;
      for (let g = 0; g < numGroups; g++) {
        groups.push(
          full.slice(g * groupSize, (g + 1) * groupSize).sort((a, b) => a - b),
        );
      }
    }

    rotations.push(groups);
  }

  return rotations;
}

function rotateArray<T>(arr: T[], steps: number): T[] {
  if (arr.length === 0) return [];
  const s = ((steps % arr.length) + arr.length) % arr.length;
  return [...arr.slice(s), ...arr.slice(0, s)];
}

/**
 * The group returned when a pattern assigns no group to this seat: the
 * participant interacts with nobody. groupIndex 0 keeps the payload shape
 * valid for callers that key rendering off it.
 */
function soloGroup(seat: number): { groupPeers: number[]; groupIndex: number } {
  return { groupPeers: [seat], groupIndex: 0 };
}

/**
 * Get the interaction group for a specific seat at a given rotation offset.
 *
 * For `round-robin`, `rotationIndex` counts elapsed round-robin routines; for
 * `sequence` the caller passes the 0-based trial index instead
 * (`progressHandler.ts`). Both wrap modulo the number of available steps.
 */
export function getInteractionGroup(
  pattern: InteractionPattern,
  seat: number,
  seatCount: number,
  rotationIndex: number,
): { groupPeers: number[]; groupIndex: number } {
  switch (pattern.type) {
    case "all":
      return {
        groupPeers: Array.from({ length: seatCount }, (_, i) => i),
        groupIndex: 0,
      };

    case "fixed": {
      const idx = pattern.groups.findIndex((g) => g.includes(seat));
      return {
        groupPeers: idx >= 0 ? pattern.groups[idx] : [seat],
        groupIndex: Math.max(idx, 0),
      };
    }

    case "round-robin": {
      const rotations = computeRoundRobinRotations(seatCount, pattern.groupSize);
      const wrappedIndex =
        ((rotationIndex % rotations.length) + rotations.length) %
        rotations.length;
      const groups = rotations[wrappedIndex];
      const idx = groups.findIndex((g) => g.includes(seat));
      return {
        groupPeers: idx >= 0 ? groups[idx] : [seat],
        groupIndex: Math.max(idx, 0),
      };
    }

    case "sequence": {
      const { steps } = pattern;
      if (steps.length === 0) return soloGroup(seat);

      const wrappedIndex =
        ((rotationIndex % steps.length) + steps.length) % steps.length;
      const groups = steps[wrappedIndex];
      const idx = groups.findIndex((g) => g.includes(seat));
      if (idx < 0) return soloGroup(seat);

      return { groupPeers: groups[idx], groupIndex: idx };
    }

    default:
      return soloGroup(seat);
  }
}

/**
 * Compute the rotation index for a given progress, counting only
 * round-robin routines between the matching point and current progress.
 */
export function computeRotationIndex(
  routines: RoutineConfig[] | Map<number, RoutineConfig>,
  matchProgress: number,
  currentProgress: number,
): number {
  let count = 0;
  for (let i = matchProgress + 1; i < currentProgress; i++) {
    const routine = routines instanceof Map ? routines.get(i) : routines[i];
    if (routine?.interactionPattern?.type === "round-robin") {
      count++;
    }
  }
  return count;
}

/** Fewer than two seats cannot form an interaction group at all. */
export const MinimumSeatCount = 2;
/** A group of one is a participant alone in a video chat, never a valid design. */
export const MinimumGroupSize = 2;

/**
 * Validate a cohort/group-size pair before it is used for rotation.
 *
 * `computeRoundRobinRotations` degrades silently to a single all-seats group
 * when the numbers do not divide (B8); it keeps that contract because it runs
 * per content delivery. This is the blocking check callers use instead —
 * `updateExperiment` on save, and the Session Designer at authoring time.
 *
 * @returns null when the pair is valid, otherwise a message naming both numbers.
 */
export function validateRotation(
  seatCount: number,
  groupSize: number,
): string | null {
  if (!Number.isInteger(seatCount) || seatCount < MinimumSeatCount) {
    return `Cohort of ${seatCount} is too small to form interaction groups (need at least ${MinimumSeatCount})`;
  }
  if (!Number.isInteger(groupSize) || groupSize < MinimumGroupSize) {
    return `Group size of ${groupSize} leaves every participant alone (need at least ${MinimumGroupSize})`;
  }
  if (groupSize > seatCount) {
    return `Group size of ${groupSize} exceeds the cohort of ${seatCount}`;
  }
  if (seatCount % groupSize !== 0) {
    return `Cohort of ${seatCount} cannot be split into groups of ${groupSize}`;
  }
  return null;
}
