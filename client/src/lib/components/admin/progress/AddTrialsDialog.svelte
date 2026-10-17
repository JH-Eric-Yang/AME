<!-- client/src/lib/components/admin/progress/AddTrialsDialog.svelte -->
<script lang="ts">
  import type { RoutineConfig } from "ame-shared";
  import { getParamInfo } from "ame-shared/parameterHelp";
  import type { AssetSummary } from "$lib/api";
  import { assetRef } from "$lib/media/assetSrc";
  import { trialTargets, sortByFileName, trialsPreview } from "$lib/admin/addTrials";
  import { parsePastedValues } from "$lib/admin/paramValues";
  import { MaxTrialsPerInsert, type TrialTargetRef } from "$lib/admin/progressSteps";
  import AssetPickerDialog from "../canvas/AssetPickerDialog.svelte";

  let { routines, assets, endPosition, belowPosition, refusal = "", onedit, onadd, onclose }: {
    routines: RoutineConfig[]; assets: AssetSummary[];
    /** Where "At the end" inserts: the step count. */
    endPosition: number;
    /** Where "Below the selected step" inserts; null when no unlocked step is selected. */
    belowPosition: number | null;
    /** Why the last add was refused; empty when there is no refusal. */
    refusal?: string;
    /** The researcher changed an input, so the refusal is stale. */
    onedit: () => void;
    onadd: (target: TrialTargetRef, values: unknown[], at: number) => void;
    onclose: () => void;
  } = $props();

  let routineName = $state("");
  let targetKey = $state("");
  let files = $state<AssetSummary[]>([]);
  let pasted = $state("");
  let where = $state<"end" | "below">("end");
  let picking = $state(false);

  const routine = $derived(routines.find((r) => r.name === routineName) ?? null);
  const targets = $derived(routine ? trialTargets(routine) : []);
  const target = $derived(targets.find((t) => t.key === targetKey) ?? null);
  const pastedResult = $derived(
    target && !target.media ? parsePastedValues(getParamInfo(target.elementType, target.param)!, pasted) : { values: [], error: null },
  );
  const values = $derived<unknown[]>(target?.media ? files.map((f) => assetRef(f.id)) : pastedResult.values);
  const at = $derived(where === "below" && belowPosition !== null ? belowPosition : endPosition);
  const tooMany = $derived(values.length > MaxTrialsPerInsert);
  const canAdd = $derived(target !== null && values.length > 0 && !pastedResult.error && !tooMany);

  // Any change to an input clears the refusal that the old input caused.
  $effect(() => {
    void [routineName, targetKey, pasted, files, where];
    onedit();
  });

  function selectRoutine(name: string) {
    routineName = name;
    targetKey = "";
    files = [];
    pasted = "";
  }
  function selectTarget(key: string) {
    targetKey = key;
    files = [];
    pasted = "";
  }
  function add() {
    if (!canAdd || !routine || !target) return;
    onadd({ routine: routine.name, element: target.element, param: target.param }, values, at);
  }
</script>

<!-- While the file picker is open on top, Escape belongs to it. This listener
     was registered first, so it still reads picking === true here. -->
<svelte:window onkeydown={(e) => { if (e.key === "Escape" && !picking) onclose(); }} />

<div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Add trials from stimuli" tabindex="-1">
    <h3>Add trials from stimuli</h3>
    <p class="hint">Each value makes one step. The step changes only the param you select.</p>

    <label>Routine
      <select value={routineName} onchange={(e) => selectRoutine(e.currentTarget.value)}>
        <option value="">Choose a routine…</option>
        {#each routines as r (r.name)}<option value={r.name}>{r.name}</option>{/each}
      </select>
    </label>

    {#if routine}
      {#if targets.length === 0}
        <p class="hint">This routine has no stimulus params. Choose a different routine.</p>
      {:else}
        <label>Element and param
          <select value={targetKey} onchange={(e) => selectTarget(e.currentTarget.value)}>
            <option value="">Choose a param…</option>
            {#each targets as t (t.key)}<option value={t.key}>{t.label}</option>{/each}
          </select>
        </label>
      {/if}
    {/if}

    {#if target?.media}
      <div class="files">
        <div class="row">
          <button type="button" class="btn" onclick={() => (picking = true)}>Choose files…</button>
          <button type="button" class="btn" disabled={files.length < 2} onclick={() => (files = sortByFileName(files))}>Sort by name</button>
        </div>
        {#if files.length > 0}
          <ol class="list">{#each files as f (f.id)}<li>{f.fileName}</li>{/each}</ol>
        {/if}
      </div>
    {:else if target}
      <label>Values, one on each line
        <textarea rows="8" bind:value={pasted}></textarea>
      </label>
    {/if}

    {#if target}
      <fieldset>
        <legend>Where</legend>
        <label class="inline"><input type="radio" bind:group={where} value="end" /> At the end</label>
        <label class="inline"><input type="radio" bind:group={where} value="below" disabled={belowPosition === null} /> Below the selected step</label>
      </fieldset>
    {/if}

    {#if refusal}<p class="error">{refusal}</p>{/if}
    {#if pastedResult.error}<p class="error">{pastedResult.error}</p>{/if}
    {#if tooMany}<p class="error">The list has {values.length} values. Add {MaxTrialsPerInsert} or fewer at one time.</p>{/if}
    {#if canAdd && target}<p class="preview">{trialsPreview(values.length, at, routineName, target)}</p>{/if}

    <div class="row">
      <button type="button" class="btn primary" disabled={!canAdd} onclick={add}>Add</button>
      <button type="button" class="btn" onclick={onclose}>Cancel</button>
    </div>
  </div>
</div>

{#if picking && target?.media}
  <AssetPickerDialog {assets} accept={target.media} multiple
    onpickmany={(picked) => { files = picked; picking = false; }} onclose={() => (picking = false)} />
{/if}

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); display: flex; align-items: center; justify-content: center; z-index: 40; }
  .dialog { background: var(--white); padding: 16px; width: min(520px, calc(100vw - 32px)); max-height: 80vh; overflow: auto; display: flex; flex-direction: column; gap: 10px; font-size: 12px; }
  h3 { margin: 0; font-size: 14px; }
  label { display: flex; flex-direction: column; gap: 4px; }
  label.inline { flex-direction: row; align-items: center; gap: 6px; }
  textarea { font-family: ui-monospace, monospace; font-size: 12px; }
  fieldset { border: 1px solid var(--gray-200); padding: 6px 8px; }
  .row { display: flex; gap: 6px; }
  .list { margin: 6px 0 0; padding-left: 20px; max-height: 160px; overflow: auto; }
  .hint, .preview { color: var(--gray-500); margin: 0; }
  .error { color: var(--danger); margin: 0; }
  .btn { padding: 4px 10px; border: 1px solid var(--black); background: var(--white); font: inherit; cursor: pointer; }
  .btn.primary { background: var(--black); color: var(--white); }
  .btn:disabled { opacity: 0.4; cursor: default; }
</style>
