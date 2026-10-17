<script lang="ts">
  import type { RoutineConfig } from "ame-shared";
  import type { Step } from "ame-shared/progressSequence";
  import { producersOf, consumersOf, describeRef } from "$lib/admin/progressSummary";
  import type { GutterCell } from "$lib/admin/sequenceGutter";

  let { step, routine, content, cell, errors, warnings, selected, onselect }: {
    step: Step; routine: RoutineConfig | undefined; content: Record<string, unknown>; cell: GutterCell;
    errors: string[]; warnings: string[]; selected: boolean; onselect: () => void;
  } = $props();

  const Glyph: Record<string, string> = { media: "🎥", value: "📝" };
  const produces = $derived(routine ? producersOf(routine) : []);
  const consumes = $derived(routine ? consumersOf(routine, content) : []);
</script>

<button type="button" class="card" class:selected class:generated={step.generated} aria-label={`Step ${step.position}`} aria-pressed={selected} onclick={onselect}>
  <div class="head">
    <span class="pos mono">p{step.position}</span>
    <span class="trial mono">t{step.trial}</span>
    <span class="routine">{step.routine}</span>
    {#if cell.rotation !== null}<span class="tag">rotation {cell.rotation}</span>{/if}
    {#if step.generated}<span class="tag">block</span>{/if}
    {#if errors.length > 0}<span class="tag error" title={errors.join("\n")}>{errors.length} error{errors.length === 1 ? "" : "s"}</span>{/if}
    {#if warnings.length > 0}<span class="tag warn" title={warnings.join("\n")}>{warnings.length} warning{warnings.length === 1 ? "" : "s"}</span>{/if}
  </div>
  {#if !routine}
    <p class="line missing">routine "{step.routine}" not found</p>
  {:else}
    <p class="line"><span class="label">Produces</span>
      {#if produces.length === 0}<span class="muted">nothing</span>{/if}
      {#each produces as p (p.element)}<span class="chip">{Glyph[p.kind]} {p.element}</span>{/each}
    </p>
    <p class="line"><span class="label">Consumes</span>
      {#if consumes.length === 0}<span class="muted">nothing</span>{/if}
      {#each consumes as c (c.element + c.ref)}<span class="chip mono" class:bad={!c.parsed}>{c.parsed ? describeRef(c.parsed) : c.ref}</span>{/each}
    </p>
  {/if}
</button>

<style>
  .card { display: block; width: 100%; text-align: left; padding: 8px 10px; margin: 0 0 6px; border: 1px solid var(--gray-200); background: #fff; font: inherit; cursor: pointer; }
  .card.selected { border-color: var(--black); box-shadow: inset 2px 0 0 var(--black); }
  .card.generated { background: var(--gray-50); }
  .head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; font-size: 13px; }
  .pos { font-weight: 600; }
  .trial, .muted { color: var(--gray-500); }
  .tag { font-size: 10px; padding: 1px 6px; border: 1px solid var(--gray-300); border-radius: var(--radius-sm); }
  .tag.error { border-color: var(--danger); color: var(--danger); }
  .tag.warn { border-color: var(--accent); color: var(--accent); }
  .line { margin: 4px 0 0; font-size: 12px; }
  .label { display: inline-block; width: 5.5em; color: var(--gray-500); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; }
  .chip { display: inline-block; margin-right: 6px; }
  .chip.bad, .missing { color: var(--danger); }
  .mono { font-family: ui-monospace, monospace; }
</style>
