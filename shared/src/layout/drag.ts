import type { FreePlacement } from "../types.js";
import { clampPlacement, overlaps } from "./free.js";

/** How near an edge must come, in stage %, before it snaps flush to it. */
export const SnapThresholdPct = 1.5;

/** The stage's own extent, in the percentage units placements are stored in. */
const StageExtent = 100;

/** An alignment line to draw while dragging. */
export interface Guide {
  axis: "x" | "y";
  atPct: number;
}

export interface DragInput {
  /** Pointer position, in stage percentages. */
  pointerPct: { x: number; y: number };
  /** Where inside the box the drag began, so it does not jump to the cursor. */
  grabOffsetPct: { x: number; y: number };
  dragged: FreePlacement;
  /** Every other placement with a footprint, for collision and snapping. */
  others: FreePlacement[];
  /** Optional coarse grid, in stage %. */
  snapPct?: number;
}

export interface DragResult {
  placement: FreePlacement;
  /** False when the result overlaps a neighbour: the caller shows it as invalid. */
  valid: boolean;
  guides: Guide[];
}

/** The candidate lines a dragged edge can snap to on one axis. */
function snapLines(others: FreePlacement[], axis: "x" | "y"): number[] {
  const lines = [0, StageExtent / 2, StageExtent];
  for (const o of others) {
    const start = axis === "x" ? o.xPct : o.yPct;
    const extent = axis === "x" ? o.wPct : o.hPct;
    lines.push(start, start + extent, start + extent / 2);
  }
  return lines;
}

/** Snap one edge to the nearest line within the threshold, else leave it. */
function snapEdge(
  start: number,
  extent: number,
  lines: number[],
): { value: number; guide: number | null } {
  let best: { value: number; guide: number } | null = null;
  for (const line of lines) {
    // A box can snap by its leading edge, its trailing edge, or its centre.
    for (const candidate of [line, line - extent, line - extent / 2]) {
      const distance = Math.abs(candidate - start);
      if (distance > SnapThresholdPct) continue;
      if (!best || distance < Math.abs(best.value - start)) {
        best = { value: candidate, guide: line };
      }
    }
  }
  return best ? { value: best.value, guide: best.guide } : { value: start, guide: null };
}

export function resolveDrag(input: DragInput): DragResult {
  const { pointerPct, grabOffsetPct, dragged, others, snapPct } = input;

  let xPct = pointerPct.x - grabOffsetPct.x;
  let yPct = pointerPct.y - grabOffsetPct.y;

  if (snapPct && snapPct > 0) {
    xPct = Math.round(xPct / snapPct) * snapPct;
    yPct = Math.round(yPct / snapPct) * snapPct;
  }

  const x = snapEdge(xPct, dragged.wPct, snapLines(others, "x"));
  const y = snapEdge(yPct, dragged.hPct, snapLines(others, "y"));

  const placement = clampPlacement({
    ...dragged,
    xPct: x.value,
    yPct: y.value,
  });

  const guides: Guide[] = [];
  if (x.guide !== null) guides.push({ axis: "x", atPct: x.guide });
  if (y.guide !== null) guides.push({ axis: "y", atPct: y.guide });

  return {
    placement,
    valid: !others.some((o) => overlaps(placement, o)),
    guides,
  };
}
