<script lang="ts">
  import { onMount } from "svelte";
  import type { ElementConfig, InputOptionGroupParams } from "ame-shared";
  import { recordAndFire, recordDefault } from "$lib/elements/fireEvents";
  import { optionGroupDefault } from "$lib/elements/inputDefaults";

  let { element }: { element: ElementConfig } = $props();
  const p = $derived(element.params as InputOptionGroupParams);
  const optionType = $derived(p.optionType ?? "radio");
  const isMulti = $derived(optionType === "checkbox");

  // svelte-ignore state_referenced_locally -- a deliberate mount-time snapshot: the
  // input starts from its default and then belongs to the participant.
  let selected = $state<string | string[]>(optionGroupDefault(p.defaultValue, isMulti, p.options ?? []));

  // A pre-selected value is the answer until the participant changes it.
  onMount(() => {
    recordDefault(element, selected);
  });

  function commit(value: string | string[]) {
    selected = value;
    recordAndFire(element, "change", value);
  }

  function selectSingle(value: string) {
    commit(value);
  }

  function toggleMulti(value: string) {
    const current = Array.isArray(selected) ? selected : [];
    commit(
      current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value],
    );
  }

  function isSelected(value: string): boolean {
    return Array.isArray(selected) ? selected.includes(value) : selected === value;
  }
</script>

<div class="el-option-group" class:inline={p.inline}>
  {#each p.options ?? [] as opt (opt.value)}
    {#if optionType === "toggle"}
      <button
        type="button"
        class="toggle"
        class:active={isSelected(opt.value)}
        aria-pressed={isSelected(opt.value)}
        onclick={() => selectSingle(opt.value)}
      >
        {opt.label}
      </button>
    {:else}
      <label class="option">
        <input
          type={optionType === "checkbox" ? "checkbox" : "radio"}
          name={element.name}
          value={opt.value}
          checked={isSelected(opt.value)}
          onchange={() =>
            optionType === "checkbox" ? toggleMulti(opt.value) : selectSingle(opt.value)}
        />
        <span>{opt.label}</span>
      </label>
    {/if}
  {/each}
</div>

<style>
  .el-option-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
  }
  .el-option-group.inline {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 1rem;
  }
  .option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 14px;
    cursor: pointer;
  }
  .option input {
    accent-color: var(--black);
    cursor: pointer;
  }
  .toggle {
    padding: 0.5rem 1rem;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    background: #fff;
    color: var(--black);
    font-size: 14px;
    font-family: var(--font-body);
    cursor: pointer;
    transition: border-color var(--transition), background var(--transition);
  }
  .toggle:hover { border-color: var(--black); }
  .toggle.active { background: var(--gray-50); border: 1.5px solid var(--black); }
</style>
