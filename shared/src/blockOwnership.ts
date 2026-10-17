import type { SessionDesign, DriftEntry } from "./sessionDesign.js";
import { stepsForDesign } from "./sessionDesign.js";

/**
 * How a session block's ownership of a routine is worded in the Builder, and
 * how a disagreement between the block and the Builder is headlined.
 *
 * The Builder's editors stay live on an owned routine — two surfaces may write
 * the same field — so this module exists to say which block claims a routine
 * and how many differences were found, not to lock anything.
 */

/** Curly quotes and an em dash, matching design/DriftStrip.dc.html verbatim. */
const OpenQuote = "“";
const CloseQuote = "”";
const Dash = "—";

/** `3 rotations`, `1 rotation` — a plain "s" is correct for every noun used here. */
function pluralise(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The routines a block compiles and therefore claims: its match routine, its
 * trial routine, its end-match routine, and its inter-trial routine when set.
 * Blank names are dropped so an unnamed slot cannot be "owned".
 *
 * Both guards below are load-bearing, not decoration. This runs against
 * `Experiment.sessionDesigns`, a Json column, on the live matching path AND in
 * `validateRoutineRotations`, which runs BEFORE the shape guard in
 * `validateSessionDesigns` that would otherwise refuse the input. A design that
 * is null, or missing one of these fields, would therefore dereference
 * `null.matchRoutineName` or `undefined.length` inside an async Express handler
 * with no error middleware behind it, or inside the socket handler that creates
 * sessions. Anything unrecognisable simply claims nothing.
 */
export function ownedRoutineNames(design: SessionDesign): string[] {
  if (!design || typeof design !== "object") return [];
  const names = [design.matchRoutineName, design.trialRoutine, design.endMatchRoutineName];
  if (design.interTrialRoutine) names.push(design.interTrialRoutine);
  return names.filter((name) => typeof name === "string" && name.length > 0);
}

/** The first block claiming `routineName`, or null when no block does. */
export function findOwningDesign(
  routineName: string,
  designs: SessionDesign[],
): SessionDesign | null {
  if (routineName.length === 0) return null;
  return designs.find((design) => ownedRoutineNames(design).includes(routineName)) ?? null;
}

/**
 * The annotation shown on an owned routine in the Builder's inspector. Seats
 * are counted from `design.seats`, which is what the block compiles into the
 * match routine's slots; the validator keeps `cohortSize` equal to it.
 */
export function describeOwnership(design: SessionDesign): string {
  const rotations = stepsForDesign(design).length;
  return `owned by block ${OpenQuote}${design.label}${CloseQuote} ${Dash} ${pluralise(design.seats.length, "seat")}, ${pluralise(rotations, "rotation")}`;
}

/**
 * The drift strip's heading. It takes only the shape it reads, so a
 * `DriftEntry` gaining fields never touches this signature. The strip renders
 * nothing at zero entries, so the empty case never reaches a reader.
 */
export function driftHeadline(entries: Pick<DriftEntry, "message">[]): string {
  return `Builder edits detected ${Dash} ${pluralise(entries.length, "difference")}`;
}
