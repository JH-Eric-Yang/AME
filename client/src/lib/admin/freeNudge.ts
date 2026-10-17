import type { FreePlacement } from "ame-shared";

/**
 * Arrow-key nudge, in stage percent, for a free-mode placement.
 *
 * This is the only positioning path for anyone who cannot use a drag
 * gesture, so it has to move a placement by an exact, reproducible amount —
 * the same guarantee the numeric fields give a mouse-driven researcher.
 *
 * Deliberately arithmetic only: clamping the result to the stage is
 * `clampPlacement`'s job (ame-shared/layout, covered by Task 2's tests), so
 * the caller applies that afterwards rather than this module re-implementing
 * it and risking it drifting from the drag path's rules.
 */

/** Percent moved per arrow-key press with no modifier held. */
export const NudgeStepPct = 0.5;

/** Percent moved per arrow-key press held with Shift — a coarser jump. */
export const NudgeStepFastPct = 5;

const NudgeVectors: Record<string, { dx: number; dy: number }> = {
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
};

/**
 * The raw (unclamped) placement after one arrow-key nudge, or null when
 * `key` is not an arrow key this control handles.
 */
export function nudgePlacement(
  placement: FreePlacement,
  key: string,
  fast: boolean,
): FreePlacement | null {
  const vector = NudgeVectors[key];
  if (!vector) return null;
  const step = fast ? NudgeStepFastPct : NudgeStepPct;
  return {
    ...placement,
    xPct: placement.xPct + vector.dx * step,
    yPct: placement.yPct + vector.dy * step,
  };
}
