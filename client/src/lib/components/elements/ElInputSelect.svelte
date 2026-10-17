<script lang="ts">
  import { onMount } from "svelte";
  import type { ElementConfig, InputSelectParams } from "ame-shared";
  import { recordAndFire, recordDefault } from "$lib/elements/fireEvents";
  import { selectDefault } from "$lib/elements/inputDefaults";

  let { element }: { element: ElementConfig } = $props();
  const p = $derived(element.params as InputSelectParams);
  // svelte-ignore state_referenced_locally -- a deliberate mount-time snapshot: the
  // input starts from its default and then belongs to the participant.
  let value = $state(selectDefault(p.defaultValue, p.options ?? []));

  // A pre-selected option is the answer until the participant changes it.
  onMount(() => {
    recordDefault(element, value);
  });

  function handleChange() {
    recordAndFire(element, "change", value);
  }
</script>

<div class="el-select">
  <select bind:value onchange={handleChange}>
    <option value="" disabled selected={value === ""}>Select an option...</option>
    {#each p.options ?? [] as opt}
      <option value={opt.value}>{opt.label}</option>
    {/each}
  </select>
</div>

<style>
  .el-select { width: 100%; }
  select {
    width: 100%;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    font-size: 14px;
    font-family: var(--font-body);
    background: #fff;
    cursor: pointer;
    transition: border-color var(--transition), box-shadow var(--transition);
  }
  select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-dim); }
</style>
