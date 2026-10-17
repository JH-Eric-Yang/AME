/**
 * expression-classifier — maps MediaPipe FaceLandmarker blendshapes onto the
 * named expressions exposed by element-facial-expression-detector, and holds
 * the debounce state machine that decides when an expression counts as held.
 *
 * FaceLandmarker emits 52 ARKit-style blendshape scores per frame. The named
 * expressions below are combinations of those, chosen so a single asymmetric
 * artefact (a smirk, a wink) does not score as a full expression.
 */

import type { FacialExpression } from "ame-shared";

export interface Blendshape {
  categoryName: string;
  score: number;
}

type ScoreLookup = (categoryName: string) => number;

/** Mean of the named categories, treating absent ones as zero. */
function mean(get: ScoreLookup, ...categoryNames: string[]): number {
  const total = categoryNames.reduce((sum, name) => sum + get(name), 0);
  return total / categoryNames.length;
}

const ExpressionFormulas: Record<FacialExpression, (get: ScoreLookup) => number> = {
  smile: (get) => mean(get, "mouthSmileLeft", "mouthSmileRight"),
  frown: (get) => mean(get, "mouthFrownLeft", "mouthFrownRight"),
  // Brows raise via two independent mechanisms; the stronger one wins.
  "brow-raise": (get) =>
    Math.max(get("browInnerUp"), mean(get, "browOuterUpLeft", "browOuterUpRight")),
  "mouth-open": (get) => get("jawOpen"),
  "eyes-closed": (get) => mean(get, "eyeBlinkLeft", "eyeBlinkRight"),
  // Three signals weighted equally: raised brows, open jaw, widened eyes.
  surprise: (get) =>
    (get("browInnerUp") + get("jawOpen") + mean(get, "eyeWideLeft", "eyeWideRight")) / 3,
};

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Score how strongly a named expression is present in a frame's blendshapes.
 * Returns 0–1; absent categories count as zero.
 */
export function scoreExpression(
  expression: FacialExpression,
  blendshapes: Blendshape[],
): number {
  if (blendshapes.length === 0) return 0;

  const scores = new Map(blendshapes.map((b) => [b.categoryName, b.score]));
  const get: ScoreLookup = (name) => scores.get(name) ?? 0;

  return clamp01(ExpressionFormulas[expression](get));
}

// ── Hold state machine ─────────────────────────────────

export interface HoldState {
  /** When the score first crossed the threshold, or null if it is below it. */
  heldSince: number | null;
  /** Whether this uninterrupted hold has already fired. */
  fired: boolean;
}

export interface HoldResult {
  state: HoldState;
  /** True on the single frame the hold completes. */
  fired: boolean;
  /** Milliseconds the expression has been held, 0 when below threshold. */
  heldFor: number;
}

export function createHoldState(): HoldState {
  return { heldSince: null, fired: false };
}

/**
 * Advance the hold state by one frame.
 *
 * Fires once when the score has stayed at or above `threshold` for
 * `durationMs`; dropping below the threshold rearms it.
 */
export function updateHold(
  state: HoldState,
  score: number,
  threshold: number,
  durationMs: number,
  now: number,
): HoldResult {
  if (score < threshold) {
    return { state: createHoldState(), fired: false, heldFor: 0 };
  }

  const heldSince = state.heldSince ?? now;
  const heldFor = now - heldSince;

  if (!state.fired && heldFor >= durationMs) {
    return { state: { heldSince, fired: true }, fired: true, heldFor };
  }

  return { state: { heldSince, fired: state.fired }, fired: false, heldFor };
}
