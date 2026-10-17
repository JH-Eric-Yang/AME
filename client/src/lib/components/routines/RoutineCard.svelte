<script lang="ts">
  import { runner } from "$lib/stores/runner";
  import LayoutGrid from "./LayoutGrid.svelte";

  const config = $derived($runner.routine?.config as { width?: string; padding?: string } | undefined);

  const gridLayout = $derived($runner.routine?.layout ?? null);
</script>

<div class="routine-card-wrapper">
  <div
    class="routine-card"
    style="max-width: {config?.width ?? '600px'}; padding: {config?.padding ?? '2rem'};"
  >
    {#if gridLayout}
      <LayoutGrid layout={gridLayout} elements={$runner.elements} />
    {/if}
  </div>
</div>

<style>
  .routine-card-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 1rem;
  }
  .routine-card {
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-lg);
    background: #fff;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
    width: 100%;
  }
</style>
