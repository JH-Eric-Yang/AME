<script lang="ts">
  import type { ElementConfig, RoutineLayout, FreePlacement } from "ame-shared";
  import type { Placed, Guide } from "ame-shared/layout";
  import {
    stageSize,
    fitStageWidth,
    freeStyle,
    resolveDrag,
    clampPlacement,
    overlaps,
    styleString,
    aspectLocked,
    naturalAspectScale,
    hasIntrinsicSize,
    FreeMediaFitClass,
  } from "ame-shared/layout";
  import { nudgePlacement } from "$lib/admin/freeNudge";
  import { naturalSizes, mediaUrl } from "$lib/admin/naturalSize";
  import ElementCard from "./ElementCard.svelte";
  // The same stylesheet LayoutStage imports, so a stimulus letterboxes inside
  // its box here exactly as it does on the participant's screen.
  import "$lib/styles/freeMediaFit.css";

  /**
   * The builder's free-mode surface: a locked-ratio stage, scaled to fit this
   * panel, on which elements are dragged and resized in stage percentages.
   *
   * Renders the same geometry LayoutStage renders at runtime — same fixed
   * pixel size, same visual scale — so what a researcher drops here is what a
   * participant sees. `freeElements` is already the `assign()` "free" bucket
   * (elements with a footprint and a placement); the caller also owns the
   * "Not placed" / "Runs invisibly" strips, since those are identical to the
   * flow grid's.
   */
  interface Props {
    layout: RoutineLayout;
    freeElements: Placed[];
    selectedElementIndex: number | null;
    onselectelement: (elementIndex: number) => void;
    onremoveelement: (elementIndex: number) => void;
    /** A drag or resize settled on the stage: commit through experiment.updateElement. */
    onupdateplacement: (elementIndex: number, placement: FreePlacement) => void;
    /** A palette or "not placed" strip item released on the stage, at this stage %. */
    ondrop: (xPct: number, yPct: number, data: string) => void;
  }

  let {
    layout,
    freeElements,
    selectedElementIndex,
    onselectelement,
    onremoveelement,
    onupdateplacement,
    ondrop,
  }: Props = $props();

  /** The locked ratio, or null when the stage is fluid (see the fallback branch below). */
  const ratio = $derived(layout.stage && layout.stage !== "fluid" ? layout.stage : null);
  const size = $derived(ratio ? stageSize(ratio) : null);

  /**
   * This panel's own rendered width — see LayoutStage for why bind:client*
   * beats a resize listener.
   *
   * Width only: the builder's canvas column scrolls vertically, so its height
   * is its content's height and measuring it to size that same content is a
   * loop (see fitStageWidth). The stage fits the panel's width and the panel
   * scrolls if the result is tall — which is what a researcher expects of an
   * authoring surface, and is why this differs from LayoutStage's runtime
   * frame, where the surface is the viewport and both axes bound it.
   */
  let frameWidth = $state(0);
  /**
   * Null until the frame has been measured. `fitStageWidth` has no scale floor
   * (it must fit whatever column it is given, see FitStageOptions.minScale), so
   * the pre-measurement `frameWidth` of 0 would otherwise paint one frame of
   * `scale(0)`.
   */
  const fit = $derived(ratio && frameWidth > 0 ? fitStageWidth(ratio, frameWidth) : null);

  let stageEl = $state<HTMLDivElement>();

  type Corner = "nw" | "ne" | "sw" | "se";
  const Corners: Corner[] = ["nw", "ne", "sw", "se"];

  /**
   * The hPct/wPct a corner resize holds constant for an element, or null when
   * it is free to take any shape.
   *
   * Derived from the MEDIA's natural size, not from the box's current shape.
   * This used to lock to whatever ratio the box happened to have, which meant
   * an image dropped into the arbitrary default box was locked to that
   * arbitrary shape forever — the resize faithfully preserved something that
   * was never right. Locking to the media makes the lock mean what it says.
   *
   * Null for an unlocked element, for a fluid stage, and for media that never
   * loaded: in each case a corner drag sets width and height independently,
   * which is the behaviour every non-media element has.
   */
  function lockedAspectScale(element: ElementConfig): number | null {
    if (!aspectLocked(element)) return null;
    const url = mediaUrl(element);
    return naturalAspectScale(url ? $naturalSizes[url] : null, size);
  }

  /**
   * The free box's media class, or nothing — the twin of LayoutStage's
   * `fitClass`. Both read `hasIntrinsicSize` and both apply the shared
   * `FreeMediaFitClass`, because a stimulus the builder shows whole and the
   * runtime crops (or the reverse) is the exact disagreement free placement is
   * laid out at stage pixels to rule out.
   */
  function fitClass(element: ElementConfig): string {
    return hasIntrinsicSize(element.type) ? FreeMediaFitClass : "";
  }

  /** Floor on a corner resize, in stage %, so a drag can't shrink a box to nothing. */
  const MinFreeSizePct = 4;

  interface DragState {
    elementIndex: number;
    kind: "move" | "resize";
    corner?: Corner;
    start: FreePlacement;
    /** Move only: where inside the box the pointer grabbed it. */
    grabOffsetPct: { x: number; y: number };
    /** Resize only: pointer position when the drag began. */
    startPointerPct: { x: number; y: number };
    lockAspect: boolean;
    /**
     * Resize only: the hPct/wPct held constant while locked — the media's
     * own ratio for a locked element (see `lockedAspectScale`), and the
     * start box's own ratio only as a fallback nothing reads while unlocked.
     */
    aspectScale: number;
    current: FreePlacement;
    /** False when `current` overlaps a neighbour: shown as invalid, never committed. */
    valid: boolean;
    /** The last placement seen valid during this drag — committed if the drag ends invalid. */
    lastValid: FreePlacement;
    guides: Guide[];
  }

  let drag = $state<DragState | null>(null);

  /** Every other free element's placement, for collision and snapping against `elementIndex`. */
  function othersFor(elementIndex: number): FreePlacement[] {
    return freeElements
      .filter((p) => p.index !== elementIndex && p.element.placement)
      .map((p) => p.element.placement as FreePlacement);
  }

  /**
   * The coordinate rule: convert through the stage's rendered bounding rect,
   * never its internal pixel size. The rect is measured after the scale
   * transform, so this stays correct at any zoom.
   */
  function stagePct(e: PointerEvent): { x: number; y: number } {
    const rect = stageEl!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    };
  }

  /**
   * A resized box for one corner drag. Locked-aspect elements are driven by
   * horizontal movement only; height is derived to hold hPct/wPct constant,
   * which holds the real pixel aspect ratio constant too, since both
   * percentages scale against the same fixed stage box for the drag's
   * duration.
   */
  function resizeCorner(
    start: FreePlacement,
    corner: Corner,
    dxPct: number,
    dyPct: number,
    lockAspect: boolean,
    aspectScale: number,
  ): FreePlacement {
    const growLeft = corner === "nw" || corner === "sw";
    const growTop = corner === "nw" || corner === "ne";

    let wPct = Math.max(MinFreeSizePct, start.wPct + (growLeft ? -dxPct : dxPct));
    let hPct: number;
    if (lockAspect) {
      hPct = Math.max(MinFreeSizePct, wPct * aspectScale);
      wPct = hPct / aspectScale; // re-derive so the ratio stays exact even at the floor
    } else {
      hPct = Math.max(MinFreeSizePct, start.hPct + (growTop ? -dyPct : dyPct));
    }

    const right = start.xPct + start.wPct;
    const bottom = start.yPct + start.hPct;
    return {
      wPct,
      hPct,
      xPct: growLeft ? right - wPct : start.xPct,
      yPct: growTop ? bottom - hPct : start.yPct,
    };
  }

  function handleMoveStart(e: PointerEvent, placed: Placed) {
    if (e.button !== 0 || !placed.element.placement) return;
    const start = placed.element.placement;
    const pct = stagePct(e);
    const box = e.currentTarget as HTMLElement;
    box.setPointerCapture(e.pointerId);
    // preventDefault below suppresses the focus a click would normally give,
    // and the arrow-key nudge is bound to this box: without this, clicking an
    // element would select it but leave the keys doing nothing.
    box.focus();
    drag = {
      elementIndex: placed.index,
      kind: "move",
      start,
      grabOffsetPct: { x: pct.x - start.xPct, y: pct.y - start.yPct },
      startPointerPct: pct,
      lockAspect: false,
      aspectScale: 1,
      current: start,
      valid: true,
      lastValid: start,
      guides: [],
    };
    onselectelement(placed.index);
    e.preventDefault();
  }

  function handleResizeStart(e: PointerEvent, placed: Placed, corner: Corner) {
    if (e.button !== 0 || !placed.element.placement) return;
    // Otherwise this also bubbles to the box's own pointerdown as a move-start.
    e.stopPropagation();
    const start = placed.element.placement;
    const scale = lockedAspectScale(placed.element);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = {
      elementIndex: placed.index,
      kind: "resize",
      corner,
      start,
      grabOffsetPct: { x: 0, y: 0 },
      startPointerPct: stagePct(e),
      lockAspect: scale !== null,
      aspectScale: scale ?? start.hPct / start.wPct,
      current: start,
      valid: true,
      lastValid: start,
      guides: [],
    };
    onselectelement(placed.index);
    e.preventDefault();
  }

  function handlePointerMove(e: PointerEvent) {
    if (!drag) return;
    const pct = stagePct(e);
    const others = othersFor(drag.elementIndex);

    if (drag.kind === "move") {
      // resolveDrag does the whole decision — snapping, clamping, collision,
      // guides — so this component never reimplements any of it.
      const result = resolveDrag({
        pointerPct: pct,
        grabOffsetPct: drag.grabOffsetPct,
        dragged: drag.start,
        others,
      });
      drag = {
        ...drag,
        current: result.placement,
        valid: result.valid,
        guides: result.guides,
        lastValid: result.valid ? result.placement : drag.lastValid,
      };
    } else {
      const dxPct = pct.x - drag.startPointerPct.x;
      const dyPct = pct.y - drag.startPointerPct.y;
      const resized = clampPlacement(
        resizeCorner(drag.start, drag.corner!, dxPct, dyPct, drag.lockAspect, drag.aspectScale),
      );
      const valid = !others.some((o) => overlaps(resized, o));
      drag = {
        ...drag,
        current: resized,
        valid,
        guides: [],
        lastValid: valid ? resized : drag.lastValid,
      };
    }
  }

  /**
   * The element whose last arrow-key nudge was refused for overlapping a
   * neighbour, shown as invalid until the next key moves it somewhere legal.
   */
  let nudgeBlocked = $state<number | null>(null);

  /**
   * Arrow-key nudge — the only positioning path for anyone who cannot use a
   * drag gesture, so it has to move a box by an exact, reproducible amount.
   *
   * It lives on the box, not on the window. The Inspector used to bind
   * <svelte:window onkeydown>, which meant that while any element was selected
   * in a free-mode routine, every arrow key anywhere in the admin app was
   * preventDefault'ed and nudged the selection — its INPUT/TEXTAREA/SELECT
   * guard caught typing but not page scrolling or a focused button. Scoped
   * here, a key only moves the box the researcher is actually on.
   *
   * Declines an overlapping result and flags it rather than committing it,
   * matching what a drag released on a neighbour does.
   */
  function handleBoxKeydown(e: KeyboardEvent, placed: Placed) {
    const current = placed.element.placement;
    if (!current) return;
    const nudged = nudgePlacement(current, e.key, e.shiftKey);
    if (!nudged) return;
    e.preventDefault();
    const next = clampPlacement(nudged);
    if (othersFor(placed.index).some((o) => overlaps(next, o))) {
      nudgeBlocked = placed.index;
      return;
    }
    nudgeBlocked = null;
    onupdateplacement(placed.index, next);
  }

  /** Release: commit the last valid placement seen, never an overlapping one. */
  function handlePointerEnd() {
    if (!drag) return;
    const final = drag.valid ? drag.current : drag.lastValid;
    onupdateplacement(drag.elementIndex, final);
    drag = null;
  }

  // Palette (new element) and "not placed" strip (existing element) drops
  // stay HTML5 drag-and-drop: each is one discrete drop carrying the same
  // dataTransfer payload CanvasBuilder.handleDrop already understands.
  let stageDragOver = $state(false);

  function handleStageDragOver(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === "copy" ? "copy" : "move";
    }
    stageDragOver = true;
  }

  function handleStageDragLeave(e: DragEvent) {
    if (stageEl && !stageEl.contains(e.relatedTarget as Node)) stageDragOver = false;
  }

  function handleStageDrop(e: DragEvent) {
    e.preventDefault();
    stageDragOver = false;
    const data = e.dataTransfer?.getData("application/json");
    if (!data || !stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    ondrop(xPct, yPct, data);
  }
</script>

{#snippet freeBoxes()}
  {#each freeElements as p (p.element.name)}
    {@const live = drag?.elementIndex === p.index ? drag.current : (p.element.placement as FreePlacement)}
    {@const dragging = drag?.elementIndex === p.index}
    {@const invalid = (dragging && drag !== null && !drag.valid) || nudgeBlocked === p.index}
    <!--
      Focusable so the arrow-key nudge is scoped to this box rather than bound
      to the window. ARIA has no role for "a movable object on a canvas": the
      interactive roles that would silence these two warnings (button, option)
      all forbid the nested controls ElementCard renders, so the honest
      description stays `group` plus an aria-label naming every gesture.
    -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="free-box {fitClass(p.element)}"
      class:selected={selectedElementIndex === p.index}
      class:dragging
      class:invalid
      style={styleString(freeStyle(live))}
      role="group"
      tabindex="0"
      aria-label="{p.element.name} — drag to move, corner handles to resize, arrow keys to nudge"
      onpointerdown={(e) => handleMoveStart(e, p)}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerEnd}
      onpointercancel={handlePointerEnd}
      onkeydown={(e) => handleBoxKeydown(e, p)}
      onfocus={() => onselectelement(p.index)}
      onblur={() => { if (nudgeBlocked === p.index) nudgeBlocked = null; }}
    >
      <ElementCard
        element={p.element}
        elementIndex={p.index}
        selected={selectedElementIndex === p.index}
        onselect={() => onselectelement(p.index)}
        onremove={() => onremoveelement(p.index)}
        draggable={false}
      />
      <!--
        Always rendered, revealed on hover as well as on selection. They used
        to appear only once an element was selected, which meant the one
        gesture that resizes a box was invisible to anyone who had not already
        clicked it — a researcher reported the box as unresizable. The CSS
        gives them pointer events at the same moment it gives them opacity, so
        an unrevealed handle can never swallow a drag meant to move the box.
      -->
      {#each Corners as corner}
        <div
          class="resize-handle handle-{corner}"
          role="presentation"
          onpointerdown={(e) => handleResizeStart(e, p, corner)}
          onpointermove={handlePointerMove}
          onpointerup={handlePointerEnd}
          onpointercancel={handlePointerEnd}
        ></div>
      {/each}
    </div>
  {/each}

  {#if drag?.kind === "move"}
    {#each drag.guides as g}
      {#if g.axis === "x"}
        <div class="guide guide-x" style="left: {g.atPct}%;"></div>
      {:else}
        <div class="guide guide-y" style="top: {g.atPct}%;"></div>
      {/if}
    {/each}
  {/if}
{/snippet}

<div class="stage-frame" bind:clientWidth={frameWidth}>
  {#if size}
    <!--
      Nothing until the frame is measured — one frame of empty panel, rather
      than one frame of a stage scaled to 0. See `fit`.
    -->
    {#if fit}
    <!--
      .stage-fit is the layout box, .stage the painted one: a transform does
      not change a layout box, so without this the frame reserved the full
      unscaled 1280x720 and the panel scrolled a dead area at every scale.
    -->
    <div class="stage-fit" style="width: {fit.width}px; height: {fit.height}px;">
      <div
        class="stage"
        class:drag-over={stageDragOver}
        bind:this={stageEl}
        style="width: {size.width}px; height: {size.height}px; transform: scale({fit.scale});"
        role="region"
        aria-label="Free-placement stage"
        ondragover={handleStageDragOver}
        ondragleave={handleStageDragLeave}
        ondrop={handleStageDrop}
      >
        {@render freeBoxes()}
      </div>
    </div>
    {/if}
  {:else}
    <!--
      Free mode with no locked stage. Not reachable through the Inspector
      (which forces a ratio the moment Free is chosen), but enforcement is
      authoring-time only, so hand-edited or imported data can still arrive
      this way — see LayoutStage's matching fallback.
    -->
    <div
      class="stage stage--fluid"
      class:drag-over={stageDragOver}
      bind:this={stageEl}
      role="region"
      aria-label="Free-placement stage"
      ondragover={handleStageDragOver}
      ondragleave={handleStageDragLeave}
      ondrop={handleStageDrop}
    >
      {@render freeBoxes()}
    </div>
  {/if}
</div>

<style>
  .stage-frame {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem 0;
    background: var(--gray-50);
    border-radius: var(--radius);
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
    user-select: none;
  }
  .stage--fluid {
    flex: none;
    width: 100%;
    min-height: 320px;
    box-shadow: none;
    border: 1px dashed var(--gray-200);
  }
  .stage.drag-over {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .free-box {
    touch-action: none;
    cursor: move;
  }
  /* The box carries its own selected/invalid outline; a second focus ring on
     top of it just doubles the border. Focus is still visible because clicking
     or tabbing to a box also selects it. */
  .free-box:focus {
    outline: none;
  }
  .free-box :global(.element-card) {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
  }
  /*
    In free mode the card IS the participant's box, at the stage's own pixel
    size — the stage is laid out at 1280x720 and only visually scaled, so a
    mounted component sees exactly the box it will see at runtime. So the
    preview fills the box and clips to it, matching freeStyle's runtime
    `overflow: hidden`, rather than stopping at the card's flow-grid clamp.

    "Fills the box" has to be literal, which is what the next rule is for. The
    card's flow-grid furniture — 0.4rem of padding, a 0.35rem gap and the type
    /audience tag row — took about 33 stage px off the top of every free box,
    so the mounted component was NOT seeing the participant's box: a 125x42
    stimulus box previewed its contents in 125x9. Small boxes were the worst
    affected, exactly the boxes whose fit is hardest to judge by eye. The tags
    are moved on top of the preview rather than dropped, because a researcher
    still needs to read them; `.remove` was already positioned this way.
  */
  .free-box :global(.element-card .preview) {
    max-height: none;
  }
  .free-box :global(.element-card) {
    padding: 0;
    gap: 0;
  }
  .free-box :global(.element-card .chrome) {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 1;
    /* Read-only labels: never swallow a drag meant to move the box. */
    pointer-events: none;
  }
  .free-box.dragging {
    z-index: 10;
  }
  .free-box.selected :global(.element-card) {
    border-color: var(--black);
    box-shadow: inset 0 0 0 1px var(--black);
  }
  .free-box.invalid :global(.element-card) {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
    background: var(--accent-dim);
  }

  .resize-handle {
    position: absolute;
    width: 9px;
    height: 9px;
    background: var(--white);
    border: 1px solid var(--black);
    border-radius: 1px;
    touch-action: none;
    z-index: 11;
    /* Hidden AND inert until the box is hovered or selected — see the markup
       comment. Touch has no hover, which is why selection still reveals them. */
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--transition);
  }
  .free-box:hover .resize-handle,
  .free-box.selected .resize-handle {
    opacity: 1;
    pointer-events: auto;
  }
  /* Flush inside the corners, not straddling them: freeStyle now clips a
     placement to its box (so the canvas shows the clipping a participant
     gets), and a handle hanging outside the box would be clipped away. */
  .handle-nw { top: 0; left: 0; cursor: nwse-resize; }
  .handle-se { bottom: 0; right: 0; cursor: nwse-resize; }
  .handle-ne { top: 0; right: 0; cursor: nesw-resize; }
  .handle-sw { bottom: 0; left: 0; cursor: nesw-resize; }

  .guide {
    position: absolute;
    background: var(--accent);
    pointer-events: none;
    z-index: 20;
  }
  /* left/top are set inline per guide; only the cross-axis extent lives here. */
  .guide-x { top: 0; bottom: 0; width: 1px; }
  .guide-y { left: 0; right: 0; height: 1px; }
</style>
