<script lang="ts">
  import type { RoutineLayout, ElementConfig } from "ame-shared";
  import {
    assign,
    elementsInCell,
    rowStyle,
    cellStyle,
    looseCellStyle,
    defaultCellAlign,
    styleString,
  } from "ame-shared/layout";
  import { runner } from "$lib/stores/runner";
  import ElementRenderer from "../elements/ElementRenderer.svelte";

  /**
   * The flow grid's rows/cells/unplaced/background markup, factored out of
   * LayoutGrid so LayoutStage can render the same content inside a locked,
   * scaled stage without duplicating it. `layout` is expected already resolved
   * (resolvedLayout) by the caller — this component only reads the fields
   * assign() and the row/cell style helpers need.
   */
  interface Props {
    layout: RoutineLayout;
    elements: ElementConfig[];
  }

  let { layout, elements }: Props = $props();

  const placement = $derived(assign(elements, layout));

  /**
   * Element keys are scoped to the progress, never to the element name alone.
   *
   * RoutineRenderer is a plain {#if} chain with no {#key}, and runner.setContent
   * swaps routine and elements in one update without ever nulling `routine`, so
   * two consecutive progresses of the same routine type reuse the same routine
   * component instance. Keying by name alone then reuses each element component
   * across the boundary: ElTimer keeps the interval and `remaining` it built in
   * onMount for the previous progress, so from the second trial on it shows
   * 0:00 and never fires its `timeout` event again — a timer-driven routine
   * deadlocks the participant, silently. ElRecorder likewise never re-acquires
   * media, and the input elements keep the previous trial's value while
   * setContent has already cleared runner.responses.
   *
   * Read from the store rather than taken as a prop so no call site can forget
   * it — see LayoutGrid and LayoutStage, which both render this component.
   */
  const keyPrefix = $derived($runner.progress);

  /**
   * Read from the store for the same reason as keyPrefix: the alignment is a
   * fact about the routine type, so deriving it here is what keeps every call
   * site — and the builder canvas, which calls the same helper — in agreement.
   */
  const cellAlign = $derived(defaultCellAlign($runner.routine?.type));
</script>

{#each layout.rows as row, ri}
  <div style={styleString(rowStyle(row))}>
    {#each row.columns as col, ci}
      <div style={styleString(cellStyle(col, cellAlign))}>
        {#each elementsInCell(placement, ri, ci) as placed (`${keyPrefix}:${placed.element.name}`)}
          <ElementRenderer element={placed.element} />
        {/each}
      </div>
    {/each}
  </div>
{/each}

<!--
  Elements with no position. Routines built programmatically (session blocks,
  the e2e seed, CSV import) carry none at all, so this is the ordinary path,
  not an error path — it renders as a plain stack, exactly as before the grid
  existed. Only the builder marks these visually.

  Each gets a cell-shaped wrapper so the routine type's cellAlign reaches it
  too: rendered bare they inherit the container's align-items instead, and a
  borderless routine's centring would apply only to positioned elements.
-->
{#each placement.unplaced as placed (`${keyPrefix}:${placed.element.name}`)}
  <div style={styleString(looseCellStyle(cellAlign))}>
    <ElementRenderer element={placed.element} />
  </div>
{/each}

<!--
  Weightless elements: mounted so they record, listen and detect, wrapped in
  display:contents so they contribute no box and no flex gap.

  Deliberately NOT given cellAlign: align-items needs a box to act on, and a
  box is the one thing this bucket must not have. These elements draw nothing,
  so there is nothing for an alignment to align.
-->
{#each placement.background as placed (`${keyPrefix}:${placed.element.name}`)}
  <div style="display: contents">
    <ElementRenderer element={placed.element} />
  </div>
{/each}
