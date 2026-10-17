/**
 * sequenceGutter — what the strip beside the step cards shows: a bracket
 * per matching block (labelled with its cohort and pattern), the rotation
 * index of each round-robin step, and a lighter bracket per shuffled range.
 */

import type { RoutineConfig } from "ame-shared";
import { bandAt, rangeAt, type Band, type ShuffledRange, type Step } from "ame-shared/progressSequence";

type Edge = "start" | "mid" | "end" | "solo";

export interface GutterCell {
  position: number;
  band: Edge | null;
  bandLabel: string | null;
  rotation: number | null;
  shuffled: Edge | null;
}

const DyadSize = 2;

function edge(from: number, to: number, position: number): Edge {
  if (from === to) return "solo";
  if (position === from) return "start";
  if (position === to) return "end";
  return "mid";
}

export function bandLabel(band: Band): string {
  const seats = `${band.cohortSize} seats`;
  switch (band.pattern?.type) {
    case "round-robin":
      return `${seats} · round-robin ${band.groupSize === DyadSize ? "dyads" : `groups of ${band.groupSize}`}`;
    case "fixed":
      return `${seats} · fixed groups`;
    case "sequence":
      return `${seats} · explicit pairings`;
    case "all":
      return `${seats} · all together`;
    default:
      return seats;
  }
}

const rotates = (routine: RoutineConfig | undefined): boolean =>
  routine?.interactionPattern?.type === "round-robin";

export function gutterCells(steps: Step[], bands: Band[], ranges: ShuffledRange[], routines: RoutineConfig[]): GutterCell[] {
  const byName = new Map(routines.map((r) => [r.name, r]));
  let rotation = 0;
  let currentBand: Band | null = null;

  return steps.map((step) => {
    const band = bandAt(bands, step.position);
    if (band !== currentBand) {
      currentBand = band;
      rotation = 0;
    }
    const range = rangeAt(ranges, step.position);
    const rotating = band !== null && rotates(byName.get(step.routine));
    if (rotating) rotation += 1;
    const bandEdge = band ? edge(band.from, band.to, step.position) : null;
    return {
      position: step.position,
      band: bandEdge,
      bandLabel: bandEdge === "start" || bandEdge === "solo" ? bandLabel(band!) : null,
      rotation: rotating ? rotation : null,
      shuffled: range ? edge(range.from, range.to, step.position) : null,
    };
  });
}
