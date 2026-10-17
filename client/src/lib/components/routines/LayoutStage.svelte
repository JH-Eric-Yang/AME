<script lang="ts">
  import type { RoutineLayout, ElementConfig } from "ame-shared";
  import {
    assign,
    freeStyle,
    FreeMediaFitClass,
    hasIntrinsicSize,
    stageSize,
    fitStage,
    containerStyle,
    looseCellStyle,
    defaultCellAlign,
    styleString,
  } from "ame-shared/layout";
  import { runner } from "$lib/stores/runner";
  // The rule that keeps a stimulus inside its free box instead of letting the
  // box's `overflow: hidden` cut it. Global CSS, shared verbatim with the
  // builder's FreeCanvas — see the file for why it is not scoped to either.
  import "$lib/styles/freeMediaFit.css";
  import ElementRenderer from "../elements/ElementRenderer.svelte";
  import LayoutFlowContent from "./LayoutFlowContent.svelte";

  /**
   * Renders a routine surface that LayoutGrid decided needs more than the
   * plain flow container: a locked-ratio stage, a free-mode surface, or both.
   * Takes the same { layout, elements } contract as LayoutGrid, already
   * resolved (resolvedLayout) by the caller.
   */
  interface Props {
    layout: RoutineLayout;
    elements: ElementConfig[];
  }

  let { layout, elements }: Props = $props();

  /** The locked ratio, or null when the stage is fluid. */
  const ratio = $derived(layout.stage && layout.stage !== "fluid" ? layout.stage : null);
  const size = $derived(ratio ? stageSize(ratio) : null);

  /**
   * The frame's own rendered box, in CSS pixels.
   *
   * `bind:clientWidth`/`clientHeight` use a ResizeObserver under the hood, so
   * this is correct on first render as well as on every subsequent resize —
   * there is no separate "initial measurement" step to get wrong, and no need
   * for a manual `window.resize` listener (which would report the raw window
   * size rather than this frame's actual box, and could disagree with it the
   * moment surrounding chrome — padding, a scrollbar — takes any space).
   *
   * The frame's height must be DEFINITE (`height`, not `min-height`) for this
   * to mean anything: while it was `min-height: 100%` against ancestors that
   * only set `min-height`, the frame's height was driven by its own unscaled
   * 720px child, so the height fed into fitStage was >= the stage height by
   * construction and the stage could never scale down to a short window.
   */
  let frame = $state({ width: 0, height: 0 });
  const fit = $derived(ratio ? fitStage(ratio, frame) : null);

  const isFree = $derived(layout.mode === "free");

  /**
   * The free box's media class, or nothing.
   *
   * Keyed off `hasIntrinsicSize`, the same predicate the Inspector offers the
   * aspect lock from: a type whose box can be locked to its media is a type
   * whose media must fit that box.
   */
  const fitClass = (el: ElementConfig): string =>
    hasIntrinsicSize(el.type) ? FreeMediaFitClass : "";
  const placement = $derived(assign(elements, layout));
  const keyPrefix = $derived($runner.progress);
  const cellAlign = $derived(defaultCellAlign($runner.routine?.type));
</script>

<div class="stage-frame" bind:clientWidth={frame.width} bind:clientHeight={frame.height}>
  {#if size && fit}
    <!--
      Laid out at the stage's fixed size and only visually scaled, so every
      participant gets the same line breaks rather than merely the same
      proportions. `overflow: auto` on the frame lets a participant scroll if
      the stage is floored at MinStageScale and still taller than the window.

      .stage-fit is the layout box; .stage is the painted one. A transform does
      not change a layout box, so without this wrapper the frame reserved and
      scrolled the full unscaled 1280x720 at every scale — dead scroll area and
      spurious scrollbars whenever the stage was not rendering at 1:1.
      transform-origin is top left so the scaled stage lands exactly on the
      wrapper it is sized to.
    -->
    <div class="stage-fit" style="width: {fit.width}px; height: {fit.height}px;">
      <div
        class="stage"
        style="width: {size.width}px; height: {size.height}px; transform: scale({fit.scale});"
      >
        {#if isFree}
          {#each placement.free as p (`${keyPrefix}:${p.element.name}`)}
            <div class={fitClass(p.element)} style={styleString(freeStyle(p.element.placement!))}>
              <ElementRenderer element={p.element} />
            </div>
          {/each}
          {#each placement.unplaced as placed (`${keyPrefix}:${placed.element.name}`)}
            <div class="unplaced" style={styleString(looseCellStyle(cellAlign))}>
              <ElementRenderer element={placed.element} />
            </div>
          {/each}
        {:else}
          <div class="stage-flow" style={styleString(containerStyle(layout))}>
            <LayoutFlowContent {layout} {elements} />
          </div>
        {/if}
        {#each placement.background as placed (`${keyPrefix}:${placed.element.name}`)}
          <div style="display: contents"><ElementRenderer element={placed.element} /></div>
        {/each}
      </div>
    </div>
  {:else if isFree}
    <!--
      Free mode with no locked stage. Not reachable from the Inspector (Task 7
      forces a ratio the moment Free is chosen — a coordinate is only
      reproducible against a fixed stage), but enforcement is authoring-time
      only, so hand-edited or imported data can still arrive this way. Render
      it as a full-bleed relative surface rather than dropping it: positions
      are percentages of this box, just not a reproducible one.
    -->
    <div class="stage stage--fluid">
      {#each placement.free as p (`${keyPrefix}:${p.element.name}`)}
        <div class={fitClass(p.element)} style={styleString(freeStyle(p.element.placement!))}>
          <ElementRenderer element={p.element} />
        </div>
      {/each}
      {#each placement.unplaced as placed (`${keyPrefix}:${placed.element.name}`)}
        <div class="unplaced" style={styleString(looseCellStyle(cellAlign))}>
          <ElementRenderer element={placed.element} />
        </div>
      {/each}
      {#each placement.background as placed (`${keyPrefix}:${placed.element.name}`)}
        <div style="display: contents"><ElementRenderer element={placed.element} /></div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .stage-frame {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    /* Definite, and independent of the stage inside it — §5.2: a locked
       stage's surface IS the viewport. `min-height: 100%` left the frame's
       height to be set by its own unscaled 720px child, which made the height
       term of fitStage 1 by construction: the stage never scaled down to a
       short window. dvh first for mobile browsers whose 100vh overshoots. */
    height: 100vh;
    height: 100dvh;
    overflow: auto;
    /* The letterbox: a locked stage rarely matches the window's own ratio, so
       the surrounding area gets a visibly deliberate ground rather than
       stretching or clipping the stage to fit. */
    background: var(--gray-100);
  }
  /* The scaled stage's layout box — see the markup comment. */
  .stage-fit {
    position: relative;
    flex: none;
  }
  .stage {
    position: relative;
    transform-origin: top left;
    background: var(--white);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }
  .stage--fluid {
    flex: none;
    width: 100%;
    min-height: 100%;
    box-shadow: none;
  }
  .stage-flow {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
  }
  .unplaced {
    position: relative;
  }
</style>
