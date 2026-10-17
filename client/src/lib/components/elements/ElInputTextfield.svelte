<script lang="ts">
  import { onMount } from "svelte";
  import type { ElementConfig, InputTextfieldParams } from "ame-shared";
  import { runner } from "$lib/stores/runner";
  import { recordAndFire, recordDefault } from "$lib/elements/fireEvents";
  import { hasDataEvent } from "$lib/elements/elementEvents";
  import { textDefault } from "$lib/elements/inputDefaults";

  let { element }: { element: ElementConfig } = $props();
  const p = $derived(element.params as InputTextfieldParams);
  // svelte-ignore state_referenced_locally -- a deliberate mount-time snapshot: the
  // input starts from its default and then belongs to the participant.
  let value = $state(textDefault(p.defaultValue));

  // A pre-filled value is the answer until the participant changes it.
  onMount(() => {
    recordDefault(element, value);
  });

  // The live value as they type. A declared data event owns the recording, so
  // leave it alone and let the commit below go through recordAndFire.
  function handleInput() {
    if (!hasDataEvent(element, "change")) runner.setResponse(element.name, value);
  }

  // Events fire on commit, not on every keystroke.
  function handleChange() {
    recordAndFire(element, "change", value);
  }
</script>

<div class="el-textfield">
  {#if p.multiline}
    <textarea
      bind:value
      oninput={handleInput}
      onchange={handleChange}
      placeholder={p.placeholder ?? ""}
      maxlength={p.maxLength ?? undefined}
      rows="4"
    ></textarea>
  {:else}
    <input
      type="text"
      bind:value
      oninput={handleInput}
      onchange={handleChange}
      placeholder={p.placeholder ?? ""}
      maxlength={p.maxLength ?? undefined}
    />
  {/if}
</div>

<style>
  .el-textfield { width: 100%; }
  input, textarea {
    width: 100%;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    font-size: 14px;
    font-family: var(--font-body);
    background: #fff;
    box-sizing: border-box;
    transition: border-color var(--transition), box-shadow var(--transition);
  }
  textarea { resize: vertical; }
  input:focus, textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-dim); }
</style>
