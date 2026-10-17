<script lang="ts">
  import type { RoutineLayout, ElementConfig } from "ame-shared";
  import { containerStyle, resolvedLayout, styleString } from "ame-shared/layout";
  import { runner } from "$lib/stores/runner";
  import LayoutFlowContent from "./LayoutFlowContent.svelte";
  import LayoutStage from "./LayoutStage.svelte";

  interface Props {
    layout: RoutineLayout;
    elements: ElementConfig[];
  }

  let { layout, elements }: Props = $props();

  /**
   * The authored layout with its routine type's defaults filled in — currently
   * the card family's padding, which is "0" because the card supplies its own.
   * Resolved here rather than by each card routine so the builder canvas, which
   * calls the same helper, cannot drift from it. Also the one place this
   * resolution happens: LayoutStage receives the already-resolved layout below
   * rather than resolving it again.
   */
  const grid = $derived(resolvedLayout(layout, $runner.routine?.type));

  /**
   * A locked stage — or a surface in free mode, even one still marked fluid by
   * hand-edited or imported data — routes to LayoutStage instead of the plain
   * flow container below. Absent `stage` and `mode` is every routine authored
   * before this feature, and keeps rendering through the unchanged path.
   */
  const useStage = $derived(
    (grid.stage !== undefined && grid.stage !== "fluid") || grid.mode === "free",
  );
</script>

{#if useStage}
  <LayoutStage layout={grid} elements={elements} />
{:else}
  <div class="layout-container" style={styleString(containerStyle(grid))}>
    <LayoutFlowContent layout={grid} elements={elements} />
  </div>
{/if}

<style>
  .layout-container { min-height: 100%; }
</style>
