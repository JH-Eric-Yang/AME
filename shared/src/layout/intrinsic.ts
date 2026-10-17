import type { ElementConfig, ElementType, FreePlacement } from "../types.js";
import { clampPlacement, StageExtent } from "./free.js";

/**
 * intrinsic — the rule that an element's box follows the media inside it.
 *
 * A free placement is stored in stage percentages, but a medium's ratio is in
 * pixels, and the two only agree once the stage's own pixel size is known: on
 * a 1280x720 stage a square image needs hPct = wPct * (1280/720). Every
 * conversion between the two lives here so that the canvas, the resize drag and
 * the Inspector cannot each derive it slightly differently.
 */

/** A medium's own pixel dimensions, as the browser reports them. */
export interface NaturalSize {
  width: number;
  height: number;
}

/** The pixel size the stage lays out at — `stageSize()`'s return. */
export interface StagePixels {
  width: number;
  height: number;
}

/**
 * Element types whose box is a window onto media that already has a size.
 *
 * Read from what the component draws, like `hasVisualFootprint`: ElImage and
 * ElVideo paint a medium with a fixed pixel ratio, and in free placement they
 * letterbox it inside whatever box they are given (`FreeMediaFitClass`).
 * Everything else — text, a survey, a button — has no size of its own to
 * follow, so nothing would be locked TO.
 *
 * This list and the CSS rule name the same two types, and must keep doing so:
 * a type that can be locked to its media is a type whose media must fit.
 *
 * `audio` is deliberately absent: it draws a controls bar whose height is the
 * browser's, not the medium's.
 */
const IntrinsicallySizedTypes: readonly ElementType[] = ["image", "video"];

export function hasIntrinsicSize(type: ElementType): boolean {
  return IntrinsicallySizedTypes.includes(type);
}

/**
 * Whether an element's box should keep its media's natural aspect ratio.
 *
 * `lockAspect` absent is the default rule, not "false": an element authored
 * before the field existed gets the behaviour its type implies — locked for
 * the intrinsically sized types, free for everything else — so no stored
 * routine has to be migrated for the lock to mean something sensible.
 */
export function aspectLocked(el: ElementConfig): boolean {
  return el.lockAspect ?? hasIntrinsicSize(el.type);
}

/**
 * The hPct/wPct a box needs to show `natural` at its true pixel ratio on this
 * stage, or null when there is nothing to lock to.
 *
 * Null covers every "the media never loaded" case in one place — a missing
 * asset, an unset src, a video whose metadata never arrived — because all of
 * them reach here as a zero or a NaN, and the answer to all of them is the
 * same: leave the box alone.
 */
export function naturalAspectScale(
  natural: NaturalSize | null | undefined,
  stage: StagePixels | null | undefined,
): number | null {
  if (!natural || !stage) return null;
  const usable = [natural.width, natural.height, stage.width, stage.height].every(
    (n) => Number.isFinite(n) && n > 0,
  );
  if (!usable) return null;
  return (natural.height / natural.width) * (stage.width / stage.height);
}

/**
 * How far a box's shape may sit from its media's before it is worth rewriting.
 *
 * Percentage points of height. It exists to stop a conform from chasing its own
 * rounding: the value written back arrives as new props, is compared again, and
 * must compare equal or the write repeats forever.
 */
export const ConformEpsilonPct = 0.05;

/** Placements are stored to this many decimals, well inside ConformEpsilonPct. */
const PctDecimals = 3;

function roundPct(value: number): number {
  const factor = 10 ** PctDecimals;
  return Math.round(value * factor) / factor;
}

/** Whether a box already shows its media at the natural ratio. */
export function conformsToAspect(
  placement: FreePlacement,
  aspectScale: number,
  epsilonPct = ConformEpsilonPct,
): boolean {
  return Math.abs(placement.hPct - placement.wPct * aspectScale) <= epsilonPct;
}

/**
 * The same box, reshaped to its media's ratio.
 *
 * The width a researcher chose is the width they get: height is derived from
 * it, because width is the dimension they set by dragging a corner and by
 * typing in the W field. Only a box that would then be taller than the stage
 * gives that up — there the whole box shrinks, keeping the ratio, since a box
 * taller than the stage cannot be shown in full whatever its width.
 *
 * Position is put back on the stage by `clampPlacement`, the same function
 * every other authoring path clamps through. Overlap is NOT decided here: it
 * depends on the neighbours the caller is authoring against, so the caller
 * asks `firstOverlap` about the result exactly as a drag does.
 */
export function conformPlacement(
  placement: FreePlacement,
  aspectScale: number,
): FreePlacement {
  let wPct = placement.wPct;
  let hPct = wPct * aspectScale;
  if (hPct > StageExtent) {
    hPct = StageExtent;
    wPct = hPct / aspectScale;
  }
  return clampPlacement({
    ...placement,
    wPct: roundPct(wPct),
    hPct: roundPct(hPct),
  });
}

/**
 * The placement an element should be rewritten to so its box follows its
 * media, or null when it should be left exactly as it is.
 *
 * The whole decision in one tested function, so the canvas only has to supply
 * the natural size it measured and then ask its neighbours about the answer.
 * Null covers, deliberately indistinguishably: an unlocked element, a type
 * with nothing to lock to, a fluid stage, media that never loaded, and a box
 * that already has the right shape. Every one of those means "leave the box
 * alone", and a caller that treated them differently would be inventing
 * behaviour this rule does not have.
 */
export function conformTarget(
  el: ElementConfig,
  natural: NaturalSize | null | undefined,
  stage: StagePixels | null | undefined,
): FreePlacement | null {
  if (!el.placement || !aspectLocked(el)) return null;
  const scale = naturalAspectScale(natural, stage);
  if (scale === null) return null;
  if (conformsToAspect(el.placement, scale)) return null;
  return conformPlacement(el.placement, scale);
}

/**
 * The size media takes when it is fitted inside a box without being cropped —
 * the pixel answer to what `FreeMediaFitClass` does in the browser.
 *
 * Scaled by whichever axis binds first, so the result is inside the box on both
 * axes and keeps the media's ratio. Media smaller than its box is NOT grown:
 * `max-width`/`max-height` only ever shrink, and a readout that claimed an
 * enlargement the browser does not perform would be describing a different
 * screen from the participant's.
 *
 * Exists so the Inspector can tell a researcher how much of an unlocked box
 * the stimulus actually fills, using the same arithmetic the box does rather
 * than a second guess at it.
 */
export function containSize(natural: NaturalSize, box: StagePixels): NaturalSize {
  const usable = [natural.width, natural.height, box.width, box.height].every(
    (n) => Number.isFinite(n) && n > 0,
  );
  if (!usable) return { width: 0, height: 0 };
  const scale = Math.min(box.width / natural.width, box.height / natural.height, 1);
  return { width: natural.width * scale, height: natural.height * scale };
}

/** The greatest common divisor, for reducing a pixel size to a ratio. */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * The largest term a reduced ratio may carry before it stops informing anyone.
 * "16:9" tells a researcher something; "1920:1279" does not.
 */
const MaxRatioTerm = 64;

/**
 * A media size as a researcher reads it: `800×600 (4:3)`.
 *
 * Sizes that do not reduce to small whole numbers are shown as a decimal
 * ratio instead, so the readout is always something that can be compared at a
 * glance with the stage's own 16:9.
 */
export function describeNaturalSize(natural: NaturalSize): string {
  const { width, height } = natural;
  const divisor = gcd(width, height) || 1;
  const w = width / divisor;
  const h = height / divisor;
  const ratio =
    Number.isInteger(w) && Number.isInteger(h) && w <= MaxRatioTerm && h <= MaxRatioTerm
      ? `${w}:${h}`
      : `${(width / height).toFixed(2)}:1`;
  return `${width}×${height} (${ratio})`;
}
