<script lang="ts">
  import type { ElementConfig } from "ame-shared";
  import ElementRenderer from "$lib/components/elements/ElementRenderer.svelte";

  let { elements }: { elements: ElementConfig[] } = $props();
</script>

<div class="device-screen">
  {#if elements.length === 0}
    <p class="waiting">Waiting for the experiment…</p>
  {:else}
    {#each elements as element (element.name)}
      <div class="device-element">
        <ElementRenderer {element} />
      </div>
    {/each}
  {/if}
</div>

<style>
  /* One column, generous targets: this is a handset held in one hand. */
  .device-screen {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    min-height: 100vh;
    box-sizing: border-box;
  }
  .device-element {
    display: flex;
    flex-direction: column;
  }
  .waiting {
    margin: auto;
    color: var(--gray-500);
    font-size: 14px;
  }
</style>
