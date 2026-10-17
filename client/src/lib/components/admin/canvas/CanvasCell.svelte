<script lang="ts">
  import type { CellAlign } from "ame-shared";
  import { cellStyle, styleString, type Placed } from "ame-shared/layout";
  import ElementCard from "./ElementCard.svelte";

  interface Props {
    rowIndex: number;
    colIndex: number;
    span: number;
    cellAlign?: CellAlign;
    placed: Placed[];
    selectedElementIndex: number | null;
    onselectelement: (elementIndex: number) => void;
    onremoveelement: (elementIndex: number) => void;
    ondrop: (rowIndex: number, colIndex: number, data: string) => void;
  }

  let { rowIndex, colIndex, span, cellAlign, placed, selectedElementIndex, onselectelement, onremoveelement, ondrop }: Props = $props();

  // An empty cell shows a centred "Drop here" hint regardless of the routine's
  // cellAlign — there is no element yet for that alignment to apply to, and
  // .canvas-cell.empty's own align-items would otherwise lose to this inline
  // style.
  const effectiveCellAlign = $derived(placed.length === 0 ? "center" : cellAlign);

  let dragOver = $state(false);
  let dropIndex = $state(0);
  let cellEl = $state<HTMLDivElement>();

  function calculateDropIndex(e: DragEvent): number {
    if (!cellEl || placed.length === 0) return 0;
    const wrappers = cellEl.querySelectorAll(':scope > .element-wrapper');
    for (let i = 0; i < wrappers.length; i++) {
      const rect = wrappers[i].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        return i;
      }
    }
    return placed.length;
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === "copy" ? "copy" : "move";
    }
    dragOver = true;
    dropIndex = calculateDropIndex(e);
  }

  function handleDragLeave(e: DragEvent) {
    if (cellEl && !cellEl.contains(e.relatedTarget as Node)) {
      dragOver = false;
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    const data = e.dataTransfer?.getData("application/json");
    if (data) {
      try {
        const parsed = JSON.parse(data);
        parsed.insertAtOrder = dropIndex;
        ondrop(rowIndex, colIndex, JSON.stringify(parsed));
      } catch {
        ondrop(rowIndex, colIndex, data);
      }
    }
  }
</script>

<div
  class="canvas-cell"
  class:drag-over={dragOver}
  class:empty={placed.length === 0}
  style={styleString(cellStyle({ span }, effectiveCellAlign))}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
  bind:this={cellEl}
  role="region"
  aria-label="Grid cell row {rowIndex + 1} column {colIndex + 1}"
>
  {#if placed.length === 0}
    {#if dragOver}
      <div class="drop-indicator"></div>
    {:else}
      <span class="drop-hint">Drop here</span>
    {/if}
  {:else}
    {#each placed as p, i}
      {#if dragOver && dropIndex === i}
        <div class="drop-indicator"></div>
      {/if}
      <div class="element-wrapper">
        <ElementCard
          element={p.element}
          elementIndex={p.index}
          selected={selectedElementIndex === p.index}
          onselect={() => onselectelement(p.index)}
          onremove={() => onremoveelement(p.index)}
        />
      </div>
    {/each}
    {#if dragOver && dropIndex === placed.length}
      <div class="drop-indicator"></div>
    {/if}
  {/if}
</div>

<style>
  .canvas-cell {
    min-height: 60px;
    padding: 0.5rem;
    border: 1px dashed var(--gray-200);
    border-radius: var(--radius);
    transition: border-color var(--transition), background var(--transition);
  }
  /* align-items for the empty state is set inline (effectiveCellAlign), since
     the inline style from cellStyle() always wins over this class rule. */
  .canvas-cell.empty { justify-content: center; }
  .canvas-cell.drag-over { border-color: var(--black); background: var(--white); }
  .drop-hint { font-size: 11px; color: var(--gray-300); pointer-events: none; }
  .drop-indicator {
    height: 2px;
    background: var(--black);
    border-radius: 1px;
    flex-shrink: 0;
  }
</style>
