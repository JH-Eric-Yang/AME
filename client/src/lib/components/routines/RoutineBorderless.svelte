<script lang="ts">
  import { runner } from "$lib/stores/runner";
  import LayoutGrid from "./LayoutGrid.svelte";

  // No card wraps these elements, so the grid centres each one itself. That
  // rule now lives in defaultCellAlign("routine-borderless"), which LayoutGrid
  // and the builder canvas both consult, rather than being injected here.
  const layout = $derived($runner.routine?.layout ?? null);
</script>

<div class="routine-borderless">
  {#if layout}
    <LayoutGrid {layout} elements={$runner.elements} />
  {/if}
</div>

<style>
  .routine-borderless {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 100vh;
  }
</style>
