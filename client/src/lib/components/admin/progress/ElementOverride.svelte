<script lang="ts">
  import type { ElementConfig, ElementParams } from "ame-shared";
  import ParamsEditor from "../canvas/params/ParamsEditor.svelte";
  import { overrideOf, mergedParams, overridePatch, withOverride } from "$lib/admin/overrides";

  let { element, content, freeMode, experimentId, onchange }: {
    element: ElementConfig; content: Record<string, unknown>; freeMode: boolean; experimentId: string;
    onchange: (content: Record<string, unknown>) => void;
  } = $props();

  const override = $derived(overrideOf(content, element.name));
  const active = $derived(override !== null);
  const defaults = $derived(Object.entries(element.params as Record<string, unknown>));
  const merged = $derived<ElementConfig>({ ...element, params: mergedParams(element, content) as ElementParams });

  function toggle(checked: boolean) {
    if (checked) {
      onchange(withOverride(content, element.name, {}));
      return;
    }
    if (override && Object.keys(override).length > 0 && !confirm(`Drop the overrides for "${element.name}" and use the routine defaults?`)) return;
    onchange(withOverride(content, element.name, null));
  }

  const show = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));
</script>

<section class="element" class:active>
  <header>
    <span class="name">{element.name}</span>
    <span class="type">{element.type}</span>
    <label class="toggle">
      <input type="checkbox" aria-label={`Override ${element.name}`} checked={active} onchange={(e) => toggle(e.currentTarget.checked)} />
      Override
    </label>
  </header>
  {#if active}
    <!-- Editors keep local UI state (e.g. TextParamsEditor's "Custom… chosen,
         nothing typed yet" flag). `StepEditor` stays mounted across a routine
         switch at the same position, so remount on element type + name here
         too — a routine swap can reuse a name for an element of a different
         type, and the editor picked by `ParamsEditor` depends on the type. -->
    {#key `${element.type}:${element.name}`}
      <ParamsEditor element={merged} {freeMode} {experimentId}
        onchange={(params) =>
          // Diff the edited (merged) params against the routine's own
          // defaults, not against `merged` — the patch must record only what
          // this step overrides, and `element.params` is where "unchanged
          // from the routine" is defined.
          onchange(withOverride(content, element.name, overridePatch(element.params as Record<string, unknown>, params as Record<string, unknown>)))} />
    {/key}
  {:else}
    <dl class="defaults">
      {#each defaults as [key, value] (key)}<div><dt>{key}</dt><dd>{show(value)}</dd></div>{/each}
      {#if defaults.length === 0}<div class="hint">No parameters set on the routine.</div>{/if}
    </dl>
    <p class="hint">Using routine defaults</p>
  {/if}
</section>

<style>
  .element { border: 1px solid var(--gray-200); padding: 8px 10px; margin-bottom: 8px; }
  .element.active { border-color: var(--black); }
  header { display: flex; gap: 8px; align-items: baseline; margin-bottom: 6px; }
  .name { font-weight: 600; font-size: 13px; }
  .type { font-size: 11px; color: var(--gray-500); flex: 1; }
  .toggle { font-size: 12px; display: inline-flex; gap: 4px; align-items: center; }
  .defaults { margin: 0; font-size: 12px; }
  .defaults div { display: flex; gap: 8px; }
  dt { color: var(--gray-500); min-width: 6em; }
  dd { margin: 0; overflow-wrap: anywhere; }
  .hint { font-size: 11px; color: var(--gray-400); margin: 4px 0 0; }
</style>
