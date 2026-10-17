<script lang="ts">
  import type { RoutineConfig } from "ame-shared";
  import type { SequenceRow, Step } from "ame-shared/progressSequence";
  import type { GutterCell } from "$lib/admin/sequenceGutter";
  import StepCard from "./StepCard.svelte";

  let { steps, rows, routines, cells, issues, selected, onselect, onadd, onaddtrials, oninsert, onmove, onduplicate, ondelete }: {
    steps: Step[]; rows: SequenceRow[]; routines: RoutineConfig[]; cells: GutterCell[];
    issues: Map<number, { errors: string[]; warnings: string[] }>; selected: number | null;
    onselect: (position: number) => void; onadd: (routine: string) => void; onaddtrials: () => void;
    oninsert: (where: "before" | "after") => void; onmove: (direction: -1 | 1) => void;
    onduplicate: () => void; ondelete: () => void;
  } = $props();

  let addRoutine = $state("");
  const current = $derived(steps.find((s) => s.position === selected) ?? null);
  const locked = $derived(current === null || current.generated);
  const index = $derived(current ? steps.indexOf(current) : -1);
  const byName = $derived(new Map(routines.map((r) => [r.name, r])));
</script>

<div class="pane">
  <div class="toolbar">
    <select aria-label="Routine to add" value={addRoutine} onchange={(e) => (addRoutine = e.currentTarget.value)}>
      <option value="">Choose a routine…</option>
      {#each routines as r (r.name)}<option value={r.name}>{r.name}</option>{/each}
    </select>
    <button type="button" class="btn" disabled={!addRoutine} onclick={() => onadd(addRoutine)}>Add step</button>
    <button type="button" class="btn" onclick={onaddtrials}>Add trials from stimuli</button>
    <span class="sep"></span>
    <button type="button" class="btn" disabled={locked} onclick={() => oninsert("before")}>Insert above</button>
    <button type="button" class="btn" disabled={locked} onclick={() => oninsert("after")}>Insert below</button>
    <button type="button" class="btn" disabled={locked || index <= 0} onclick={() => onmove(-1)}>Move up</button>
    <button type="button" class="btn" disabled={locked || index < 0 || index >= steps.length - 1} onclick={() => onmove(1)}>Move down</button>
    <button type="button" class="btn" disabled={locked} onclick={onduplicate}>Duplicate</button>
    <button type="button" class="btn danger" disabled={locked} onclick={ondelete}>Delete</button>
  </div>

  {#if steps.length === 0}
    <p class="empty">No steps yet. Choose a routine and add the first step.</p>
  {/if}

  <ol class="steps">
    {#each steps as step, i (step.position)}
      {@const cell = cells[i]}
      <li class="row">
        <div class="gutter">
          {#if cell.band}<span class="bracket band {cell.band}" title={cell.bandLabel ?? "matching block"}></span>{/if}
          {#if cell.bandLabel}<span class="band-label">{cell.bandLabel}</span>{/if}
          {#if cell.shuffled}<span class="bracket shuffled {cell.shuffled}" title="shuffled range"></span>{/if}
          {#if cell.shuffled === "start" || cell.shuffled === "solo"}<span class="shuffled-label">shuffled</span>{/if}
        </div>
        <StepCard
          {step}
          routine={byName.get(step.routine)}
          content={rows[step.rowIndex]?.content ?? {}}
          {cell}
          errors={issues.get(step.position)?.errors ?? []}
          warnings={issues.get(step.position)?.warnings ?? []}
          selected={selected === step.position}
          onselect={() => onselect(step.position)}
        />
      </li>
    {/each}
  </ol>
</div>

<style>
  .pane { display: flex; flex-direction: column; gap: 8px; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding-bottom: 8px; border-bottom: 1px solid var(--gray-200); }
  .sep { flex-basis: 100%; height: 0; }
  .btn { padding: 4px 10px; border: 1px solid var(--black); background: #fff; font: inherit; font-size: 12px; cursor: pointer; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn.danger { border-color: var(--danger); color: var(--danger); }
  .empty { color: var(--gray-500); font-size: 13px; }
  .steps { list-style: none; margin: 0; padding: 0; }
  .row { display: grid; grid-template-columns: 28px 1fr; gap: 6px; position: relative; }
  .gutter { position: relative; }
  .bracket { position: absolute; left: 4px; top: 0; bottom: 6px; width: 3px; }
  .bracket.band { background: var(--black); }
  .bracket.band.start { top: 6px; }
  .bracket.band.end { bottom: 12px; }
  .bracket.band.solo { top: 6px; bottom: 12px; }
  .bracket.shuffled { left: 12px; width: 2px; background: var(--gray-300); }
  .band-label, .shuffled-label { position: absolute; left: 10px; top: -2px; font-size: 9px; white-space: nowrap; color: var(--gray-500); transform: rotate(-90deg) translateX(-100%); transform-origin: left top; }
  .shuffled-label { left: 18px; }
</style>
