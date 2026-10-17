import type { StageRatio } from "../types.js";

/**
 * The pixel size each locked stage lays out at.
 *
 * Layout is computed here and only visually scaled afterwards, so wrapping and
 * line breaks are identical for every participant regardless of window size.
 */
const StageSizes: Record<StageRatio, { width: number; height: number }> = {
  "16:9": { width: 1280, height: 720 },
  "4:3": { width: 1024, height: 768 },
  // 9:19.5, an iPhone-class logical viewport.
  device: { width: 390, height: 844 },
};

/**
 * The smallest scale a stage renders at. Below this the authored 14px body
 * text stops being legible, so the stage stops shrinking and the participant
 * scrolls instead.
 */
export const MinStageScale = 0.5;

export function stageSize(ratio: StageRatio): { width: number; height: number } {
  return { ...StageSizes[ratio] };
}

/**
 * The scale a stage renders at inside a box of a given size, and the size the
 * scaled stage occupies.
 *
 * `width`/`height` are the whole point of the return value: the stage itself
 * is laid out at its fixed pixel size and only visually scaled, and a
 * transform does not change a layout box, so the caller MUST size a wrapper
 * to these. Sizing the frame to the unscaled stage instead reserves and
 * scrolls the full 1280x720 at every scale.
 */
export interface FitStageOptions {
  /**
   * The floor the scale is clamped to. Defaults to `MinStageScale`.
   *
   * Only two callers exist and they want opposite things, which is why this is
   * an option rather than a constant:
   *
   * - The **runtime** stage (LayoutStage) keeps the default. A participant is
   *   reading the authored text, so below the floor the stage stops shrinking
   *   and the window scrolls instead — 7px body copy is worse than a scrollbar.
   * - The **builder** stage (FreeCanvas, via `fitStageWidth`) passes `0`. There
   *   the stage is a preview inside a fixed-width column, nobody is reading it
   *   for content, and a floor cannot be honoured: at 0.5 a 16:9 stage is
   *   640px wide, so any panel narrower than that got a stage overflowing its
   *   own column — `.stage-frame` neither clips nor scrolls, so it simply
   *   spilled over the neighbouring panels.
   *
   * Fitting must therefore be allowed to go arbitrarily small in the builder;
   * legibility there is the researcher's zoom problem, not a layout invariant.
   */
  minScale?: number;
}

export function fitStage(
  ratio: StageRatio,
  viewport: { width: number; height: number },
  { minScale = MinStageScale }: FitStageOptions = {},
): { scale: number; width: number; height: number } {
  const size = stageSize(ratio);
  const scale = Math.max(
    minScale,
    Math.min(viewport.width / size.width, viewport.height / size.height),
  );
  return { scale, width: size.width * scale, height: size.height * scale };
}

/**
 * The fit for a surface bounded by width alone.
 *
 * A vertically scrolling panel — the builder's canvas column — imposes no
 * height on its content: its height IS its content's height. Measuring that
 * and feeding it back into the scale which sets that content's height is a
 * loop, and it settles on MinStageScale rather than on the right answer.
 * Width is the one bound such a panel really imposes, so it is the only one
 * fitted against; the panel scrolls if the result is tall.
 *
 * No `minScale`: the whole contract of this function is "the result fits the
 * width you gave it", and `MinStageScale` breaks that for any width under
 * 1280 * 0.5 = 640px — which the builder's centre panel routinely is. See
 * FitStageOptions.minScale for why the runtime wants the opposite.
 */
export function fitStageWidth(
  ratio: StageRatio,
  width: number,
): { scale: number; width: number; height: number } {
  return fitStage(ratio, { width, height: Number.POSITIVE_INFINITY }, { minScale: 0 });
}
