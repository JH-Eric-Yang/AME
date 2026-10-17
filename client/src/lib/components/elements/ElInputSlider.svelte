<script lang="ts">
  import { onMount } from "svelte";
  import type { ElementConfig, InputSliderParams } from "ame-shared";
  import { runner } from "$lib/stores/runner";
  import { recordAndFire, recordDefault } from "$lib/elements/fireEvents";
  import { hasDataEvent } from "$lib/elements/elementEvents";
  import { numberDefault, sliderDefault } from "$lib/elements/inputDefaults";

  let { element }: { element: ElementConfig } = $props();
  const p = $derived(element.params as InputSliderParams);
  // svelte-ignore state_referenced_locally -- a deliberate mount-time snapshot: the
  // input starts from its default and then belongs to the participant.
  let value = $state(sliderDefault(p.defaultValue, p.min ?? 0, p.max ?? 100));

  // Only a set default is recorded; the fallback position is not an answer.
  onMount(() => {
    recordDefault(element, numberDefault(p.defaultValue) === null ? null : value);
  });

  // The live value while dragging. A declared data event owns the recording,
  // so leave it alone and let the commit below go through recordAndFire.
  function handleInput() {
    if (!hasDataEvent(element, "change")) runner.setResponse(element.name, value);
  }

  // Range inputs fire change when the participant releases the handle.
  function handleChange() {
    recordAndFire(element, "change", value);
  }
</script>

<div class="el-slider">
  <div class="slider-labels">
    {#if p.leftLabel}<span class="label-left">{p.leftLabel}</span>{/if}
    {#if p.showValue !== false}<span class="label-value">{value}</span>{/if}
    {#if p.rightLabel}<span class="label-right">{p.rightLabel}</span>{/if}
  </div>
  <input
    type="range"
    bind:value
    oninput={handleInput}
    onchange={handleChange}
    min={p.min ?? 0}
    max={p.max ?? 100}
    step={p.step ?? 1}
  />
</div>

<style>
  .el-slider { width: 100%; }
  .slider-labels {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
    color: var(--gray-500);
    margin-bottom: 0.25rem;
  }
  .label-value { font-weight: 600; color: var(--black); }
  input[type="range"] {
    width: 100%;
    cursor: pointer;
    accent-color: var(--black);
  }
</style>
