<script lang="ts">
  import type {
    RoutineLayout,
    RoutineType,
    RoutineSpecificConfig,
    RoutineVideoChatConfig,
    ElementConfig,
    FreePlacement,
  } from "ame-shared";
  import { resolveVideoLayout } from "ame-shared/videoChat";
  import CanvasCell from "./CanvasCell.svelte";
  import ElementCard from "./ElementCard.svelte";
  import FreeCanvas from "./FreeCanvas.svelte";
  import { canSplitRow, canRemoveColumn } from "$lib/admin/rowSplit";
  import {
    assign,
    elementsInCell,
    containerStyle,
    rowStyle,
    cellStyle,
    styleString,
    reservedRegions,
    defaultCellAlign,
    resolvedLayout,
    isCardFamily,
  } from "ame-shared/layout";

  interface Props {
    layout: RoutineLayout;
    routineType: RoutineType;
    routineConfig?: RoutineSpecificConfig;
    elements: ElementConfig[];
    /**
     * Names of elements to skip when rendering cells — the ones that belong
     * to another audience or surface. `elements` stays the routine's FULL,
     * unfiltered array: cell indices flow out through onselectelement and
     * ondrop into experiment.selectElement/moveElement, which index that
     * full array, so filtering the array itself would misdirect a click or a
     * drag onto the wrong element.
     */
    hiddenElementNames?: string[];
    selectedElementIndex: number | null;
    onselectelement: (elementIndex: number) => void;
    onremoveelement: (elementIndex: number) => void;
    ondrop: (rowIndex: number, colIndex: number, data: string) => void;
    /** The toolbar's "+ Row" action, reused by the tail's click. */
    onaddrow: () => void;
    /** Adds one more column to a row, splitting its existing span. */
    onsplitrow: (rowIndex: number) => void;
    /** Removes one column; its span and its elements go to a neighbour. */
    onremovecolumn: (rowIndex: number, colIndex: number) => void;
    /** A palette or element drag released on the tail: create a row, then place it there. */
    ontaildrop: (data: string) => void;
    /** Free mode only: a palette or "not placed" item released on the stage, at this stage %. */
    onfreedrop: (xPct: number, yPct: number, data: string) => void;
    /** Free mode only: a drag or resize on the stage settled — commit the new placement. */
    onupdateplacement: (elementIndex: number, placement: FreePlacement) => void;
  }

  let {
    layout,
    routineType,
    routineConfig,
    elements,
    hiddenElementNames = [],
    selectedElementIndex,
    onselectelement,
    onremoveelement,
    ondrop,
    onaddrow,
    onsplitrow,
    onremovecolumn,
    ontaildrop,
    onfreedrop,
    onupdateplacement,
  }: Props = $props();

  // Drag chrome for the "+ Row" tail — mirrors CanvasCell's own local
  // dragover tracking rather than a page-wide "something is being dragged"
  // flag, since the tail only needs to know about drags released on itself.
  let tailDragOver = $state(false);
  let tailEl = $state<HTMLDivElement>();

  function handleTailDragOver(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === "copy" ? "copy" : "move";
    }
    tailDragOver = true;
  }

  function handleTailDragLeave(e: DragEvent) {
    if (tailEl && !tailEl.contains(e.relatedTarget as Node)) {
      tailDragOver = false;
    }
  }

  function handleTailDrop(e: DragEvent) {
    e.preventDefault();
    tailDragOver = false;
    const data = e.dataTransfer?.getData("application/json");
    if (data) ontaildrop(data);
  }

  const isCard = $derived(isCardFamily(routineType));

  /**
   * The same resolution the runtime does before it styles its container, so
   * the canvas shows the geometry a participant gets rather than a second
   * guess at it. Card-family routines end up with padding "0" here for the
   * same reason they do at runtime: .card-container supplies the card's own.
   */
  const grid = $derived(resolvedLayout(layout, routineType));

  /**
   * Free mode replaces every routine-type-specific wrapper below (card
   * border, video-chat split, pos-check camera) with the free-placement
   * stage, exactly as LayoutStage does at runtime — the canvas must produce
   * the same geometry the participant gets.
   */
  const isFree = $derived(grid.mode === "free");

  const placement = $derived(
    assign(elements, grid, {
      include: (el) => !hiddenElementNames.includes(el.name),
    }),
  );

  // The routine type's own rule, read from the same helper the runtime reads.
  const cellAlign = $derived(defaultCellAlign(routineType));

  /**
   * Only the "after" regions are drawn as Built-in pills. The two "before"
   * regions — the video panel and the camera feed — already have a richer
   * treatment in this canvas (.videochat-preview and .camera-placeholder), so
   * a pill on top of them drew the same chrome twice. Their slot still says
   * where they sit relative to the grid, which is what the runtime reads.
   */
  const after = $derived(
    reservedRegions(routineType, routineConfig).filter((r) => r.slot === "after"),
  );
</script>

<!--
  The authored rows, in the box that actually holds them.

  containerStyle used to sit on .canvas-grid, but for the card, video-chat and
  pos-check branches the rows are not its children — they live inside
  .card-container, .videochat-elements and .poscheck-elements. So the canvas
  applied the layout's gap and justify-content to the routine-type label and
  the card wrapper while the rows kept whatever the stylesheet gave them:
  card rows stacked with NO gap at all against the runtime's 1rem, and the
  other two hardcoded 0.5rem. One snippet, rendered inside whichever box holds
  the rows, is what makes all five branches agree with the runtime.
-->
{#snippet rows()}
  <div class="grid-rows" style={styleString(containerStyle(grid))}>
    {#each grid.rows as row, ri}
      <div class="canvas-row-block">
        <div class="row-banner">
          <span class="row-banner-label">ROW {ri + 1}</span>
          <span class="row-banner-rule"></span>
          <button
            type="button"
            class="row-banner-add"
            disabled={!canSplitRow(row)}
            title={canSplitRow(row) ? "Add a column to this row" : "Each column has the smallest width. Remove a column first."}
            onclick={() => onsplitrow(ri)}
          >
            + Column
          </button>
        </div>
        {#if canRemoveColumn(row)}
          <!-- Same row and cell styles as the cells below, so each head is exactly its column's width. -->
          <div class="column-heads" style={styleString(rowStyle(row))}>
            {#each row.columns as col, ci}
              <div style={styleString(cellStyle({ span: col.span }, "stretch"))}>
                <div class="column-head">
                  <span>Column {ci + 1} · {col.span}/12</span>
                  <button
                    type="button"
                    class="column-remove"
                    aria-label="Remove column {ci + 1} of row {ri + 1}"
                    title="Remove this column. Its elements move to the next column."
                    onclick={() => onremovecolumn(ri, ci)}
                  >&times;</button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
        <div class="canvas-row" style={styleString(rowStyle(row))}>
          {#each row.columns as col, ci}
            <CanvasCell
              rowIndex={ri}
              colIndex={ci}
              span={col.span}
              {cellAlign}
              placed={elementsInCell(placement, ri, ci)}
              {selectedElementIndex}
              {onselectelement}
              {onremoveelement}
              {ondrop}
            />
          {/each}
        </div>
      </div>
    {/each}

    <div
      class="row-tail"
      class:drag-over={tailDragOver}
      bind:this={tailEl}
      ondragover={handleTailDragOver}
      ondragleave={handleTailDragLeave}
      ondrop={handleTailDrop}
      onclick={onaddrow}
      role="button"
      tabindex="0"
      aria-label="Add a new row"
      onkeydown={(e) => { if (e.key === "Enter") onaddrow(); }}
    >
      <span class="row-tail-label">{tailDragOver ? "Release to add a row" : "+ Row"}</span>
    </div>
  </div>
{/snippet}

<div class="canvas-grid">
  <!-- Routine type label -->
  <div class="routine-type-label">
    <span class="routine-type-tag" class:borderless={routineType === "routine-borderless"} class:card={isCard} class:video={routineType === "routine-video-chat"} class:poscheck={routineType === "routine-pos-check"}>
      {routineType.replace("routine-", "")}
    </span>
  </div>

  <!-- Free mode: the free-placement stage replaces all routine-type chrome below. -->
  {#if isFree}
    <FreeCanvas
      layout={grid}
      freeElements={placement.free}
      {selectedElementIndex}
      {onselectelement}
      {onremoveelement}
      {onupdateplacement}
      ondrop={onfreedrop}
    />

  <!-- Card wrapper for card-style routines -->
  {:else if isCard}
    <div class="card-wrapper">
      <div class="card-container">
        {@render rows()}

        <!-- Built-in elements -->
        {#if after.length > 0}
          <div class="builtin-section">
            <span class="builtin-tag">Built-in</span>
            <div class="builtin-actions">
              {#each after as region (region.id)}
                <span class="builtin-btn" class:primary={region.id !== "disagree"} class:secondary={region.id === "disagree"}>
                  {region.label}
                </span>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>

  <!-- Video chat: split layout with video placeholder (a custom layout has no panel) -->
  {:else if routineType === "routine-video-chat" && resolveVideoLayout(routineConfig as RoutineVideoChatConfig) === "auto"}
    <div class="videochat-wrapper">
      <div class="videochat-elements">
        {@render rows()}
      </div>
      <div class="videochat-preview">
        <div class="video-placeholder">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style="stroke: var(--gray-300)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="5" width="14" height="14" rx="2"/>
            <path d="M16 10l4.5-2.5v9L16 14"/>
          </svg>
          <span>Video Stream</span>
        </div>
        <div class="video-placeholder small">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style="stroke: var(--gray-300)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="5" width="14" height="14" rx="2"/>
            <path d="M16 10l4.5-2.5v9L16 14"/>
          </svg>
          <span>Local</span>
        </div>
      </div>
    </div>

  <!-- Position check: camera overlay placeholder -->
  {:else if routineType === "routine-pos-check"}
    <div class="poscheck-wrapper">
      <div class="poscheck-camera">
        <div class="camera-placeholder">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style="stroke: var(--gray-300)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M2 8V6a2 2 0 012-2h2l1.5-2h5L14 4h2a2 2 0 012 2v2"/>
            <rect x="2" y="8" width="16" height="12" rx="2"/>
          </svg>
          <span>Camera Feed + Pose Overlay</span>
        </div>
      </div>
      <div class="poscheck-elements">
        {@render rows()}
      </div>
    </div>

  <!-- Borderless: full width, no container -->
  {:else}
    {@render rows()}
  {/if}

  {#if placement.unplaced.length > 0}
    <div class="strip unplaced">
      <span class="strip-label">Not placed — shown after the grid at runtime</span>
      {#each placement.unplaced as p (p.element.name)}
        <ElementCard
          element={p.element}
          elementIndex={p.index}
          selected={selectedElementIndex === p.index}
          onselect={() => onselectelement(p.index)}
          onremove={() => onremoveelement(p.index)}
        />
      {/each}
    </div>
  {/if}

  {#if placement.background.length > 0}
    <div class="strip background">
      <span class="strip-label">Runs invisibly — no space on the screen</span>
      {#each placement.background as p (p.element.name)}
        <ElementCard
          element={p.element}
          elementIndex={p.index}
          selected={selectedElementIndex === p.index}
          onselect={() => onselectelement(p.index)}
          onremove={() => onremoveelement(p.index)}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .canvas-row-block { display: flex; flex-direction: column; gap: 0.35rem; }

  /* Inline row banner: quieter authoring furniture, not part of the
     participant's screen — see ElementCard for what "content" looks like
     by comparison. */
  .row-banner { display: flex; align-items: center; gap: 0.5rem; }
  .row-banner-label {
    font-family: var(--font-display);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: var(--gray-300);
    white-space: nowrap;
  }
  .row-banner-rule { flex: 1; height: 1px; background: var(--gray-100); }
  .row-banner-add {
    font-family: var(--font-display);
    font-size: 11px;
    padding: 0.1rem 0.5rem;
    border: 1px solid var(--gray-300);
    border-radius: var(--radius);
    background: var(--white);
    color: var(--gray-600);
    cursor: pointer;
  }
  .row-banner-add:hover:not(:disabled) { border-color: var(--black); color: var(--black); }
  .row-banner-add:disabled { opacity: 0.4; cursor: default; }
  .column-heads { display: flex; }
  .column-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: var(--font-display);
    font-size: 10px;
    color: var(--gray-400);
    padding: 0 0.25rem;
  }
  .column-remove { border: none; background: none; color: var(--gray-400); cursor: pointer; font-size: 13px; padding: 0 0.15rem; }
  .column-remove:hover { color: var(--danger); }

  /* No gap here: rowStyle's inline 1rem always won, so the declaration was dead. */
  .canvas-row { display: flex; }

  /* The tail after the last row: an additional drop target for "new row". */
  .row-tail {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 34px;
    border: 1px dashed var(--gray-200);
    border-radius: var(--radius);
    cursor: pointer;
    transition: border-color var(--transition), background var(--transition);
  }
  .row-tail:hover { border-color: var(--gray-300); }
  .row-tail.drag-over { border-color: var(--accent); background: var(--accent-dim); }
  .row-tail-label { font-family: var(--font-display); font-size: 10px; color: var(--gray-300); }
  .row-tail.drag-over .row-tail-label { color: var(--accent); }

  /* Routine type label */
  .routine-type-label { display: flex; justify-content: center; margin-bottom: 0.5rem; }
  .routine-type-tag {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 2px 8px;
    border-radius: var(--radius);
    background: var(--gray-50);
    color: var(--gray-400);
  }
  .routine-type-tag.borderless { background: none; border: 1px dashed var(--gray-200); color: var(--gray-400); }
  .routine-type-tag.card { background: var(--gray-100); color: var(--gray-600); }
  .routine-type-tag.video { background: var(--accent-dim); color: var(--accent); }
  .routine-type-tag.poscheck { background: var(--gray-100); color: var(--gray-600); }

  /* Card wrapper */
  .card-wrapper {
    display: flex;
    justify-content: center;
    padding: 1rem 0;
  }
  .card-container {
    border: 1.5px solid var(--black);
    border-radius: var(--radius-lg);
    padding: 1.5rem;
    width: 75%;
    max-width: 600px;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }

  /* Built-in section */
  .builtin-section {
    position: relative;
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px dashed var(--gray-200);
  }
  .builtin-tag {
    position: absolute;
    top: -8px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 8px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--gray-300);
    background: #fff;
    padding: 0 6px;
  }
  .builtin-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    margin-top: 0.25rem;
  }
  .builtin-btn {
    display: inline-block;
    padding: 0.35rem 1rem;
    border-radius: var(--radius);
    font-size: 11px;
    font-weight: 500;
    pointer-events: none;
    opacity: 0.5;
  }
  .builtin-btn.primary {
    background: var(--black);
    color: var(--white);
    border: 1px dashed var(--black);
  }
  .builtin-btn.secondary {
    background: var(--white);
    color: var(--black);
    border: 1px dashed var(--gray-400);
  }

  /* Video chat layout */
  .videochat-wrapper {
    display: flex;
    gap: 0.75rem;
    min-height: 200px;
  }
  .videochat-elements { flex: 1; display: flex; flex-direction: column; gap: 0.5rem; }
  .videochat-preview {
    flex: 0 0 40%;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .video-placeholder {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border: 1px dashed var(--gray-300);
    border-radius: var(--radius);
    background: var(--white);
    min-height: 120px;
  }
  .video-placeholder span { font-size: 10px; color: var(--gray-300); text-transform: uppercase; letter-spacing: 0.05em; }
  .video-placeholder.small { flex: 0 0 60px; min-height: auto; }

  /* Position check layout */
  .poscheck-wrapper {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .poscheck-camera { display: flex; }
  .camera-placeholder {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border: 1px dashed var(--gray-300);
    border-radius: var(--radius);
    background: var(--white);
    min-height: 120px;
    padding: 1rem;
  }
  .camera-placeholder span { font-size: 10px; color: var(--gray-300); text-transform: uppercase; letter-spacing: 0.05em; }
  .poscheck-elements { display: flex; flex-direction: column; gap: 0.5rem; }

  .strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.75rem;
    padding: 0.5rem;
    border: 1px dashed var(--gray-300);
    border-radius: var(--radius);
  }
  .strip-label {
    font-family: var(--font-display, monospace);
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--gray-400);
    width: 100%;
  }
</style>
