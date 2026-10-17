import type { FreePlacement } from "../types.js";
import type { StyleMap } from "./style.js";

/** The stage's own extent, in the percentage units placements are stored in. */
export const StageExtent = 100;

/**
 * The footprint an element gets when it is placed on a free stage with no
 * footprint of its own — a fresh palette drop, or an element that reaches free
 * mode having only ever been placed in the flow grid.
 *
 * One declaration, because there are two callers: the drop path in
 * CanvasBuilder and the Inspector's placement fields, which used to hold
 * hand-synchronised copies of the same two numbers.
 */
export const DefaultFreePlacement: FreePlacement = {
  xPct: 0,
  yPct: 0,
  wPct: 30,
  hPct: 15,
};

/**
 * A free placement as a style map.
 *
 * `overflow: hidden` is load-bearing, not cosmetic. Height is explicit in free
 * mode (§6.1) precisely so collision can be verified, and the builder warns
 * that content taller than its box "will be clipped for participants". Without
 * this the runtime instead let content spill out of its box and over a
 * neighbour, so the Inspector's sentence was false and the canvas — which does
 * clip, via ElementCard's .preview-text — disagreed with what a participant
 * saw. This makes the sentence true and the two agree.
 *
 * Clipping is right for content that has no size of its own, and wrong for a
 * stimulus: see `FreeMediaFitClass`, which exempts media from it.
 */
export function freeStyle(p: FreePlacement): StyleMap {
  return {
    position: "absolute",
    left: `${p.xPct}%`,
    top: `${p.yPct}%`,
    width: `${p.wPct}%`,
    height: `${p.hPct}%`,
    "box-sizing": "border-box",
    overflow: "hidden",
  };
}

/**
 * The class a free-placement box carries when what it holds is media with a
 * size of its own — `hasIntrinsicSize`, i.e. image and video.
 *
 * The counterpart to `freeStyle`'s `overflow: hidden`, and the reason it is
 * declared here beside it. That clip is what a researcher is promised for
 * text, and what must never happen to a stimulus: an image cut in half is not
 * the stimulus the experimenter believes they presented, and nothing on the
 * canvas or in the Inspector said a pixel had gone. Under this class the media
 * is capped to the box and letterboxes inside it instead.
 *
 * The rule itself is CSS, so it cannot live in the style map: it is in
 * `client/src/lib/styles/freeMediaFit.css`, imported by BOTH renderers of a
 * free box — LayoutStage (the participant) and FreeCanvas (the builder). The
 * name is shared so the two cannot drift apart.
 */
export const FreeMediaFitClass = "free-media-fit";

/**
 * The nearest placement that lies wholly on the stage.
 *
 * A box larger than the stage is shrunk rather than pushed, so clamping always
 * yields something a participant can see in full.
 */
export function clampPlacement(p: FreePlacement): FreePlacement {
  const wPct = Math.min(p.wPct, StageExtent);
  const hPct = Math.min(p.hPct, StageExtent);
  return {
    wPct,
    hPct,
    xPct: Math.min(Math.max(p.xPct, 0), StageExtent - wPct),
    yPct: Math.min(Math.max(p.yPct, 0), StageExtent - hPct),
  };
}

/**
 * Whether two placements intersect.
 *
 * Boxes that merely touch do not overlap: edge snapping puts them flush on
 * purpose, and a flush pair must stay legal.
 */
export function overlaps(a: FreePlacement, b: FreePlacement): boolean {
  return (
    a.xPct < b.xPct + b.wPct &&
    b.xPct < a.xPct + a.wPct &&
    a.yPct < b.yPct + b.hPct &&
    b.yPct < a.yPct + a.hPct
  );
}
