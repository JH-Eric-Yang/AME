<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import * as api from "$lib/api";
  import type { AssetSummary } from "$lib/api";
  import { experiment } from "$lib/stores/experiment";
  import { progressDirty } from "$lib/stores/progressDirty";
  import type { RandomizationRange, RoutineConfig } from "ame-shared";
  import { stepsFor, matchingBands, shuffledRanges, type SequenceRow } from "ame-shared/progressSequence";
  import { validateContentRows } from "ame-shared/contentValidation";
  import { findOwningDesign } from "ame-shared/blockOwnership";
  import {
    insertStep, insertTrials, deleteStep, moveStep, duplicateStep, changeRoutine, remapRoutineRefs, renumber,
    type Dependant, type EditResult, type TrialTargetRef,
  } from "$lib/admin/progressSteps";
  import AddTrialsDialog from "./AddTrialsDialog.svelte";
  import { gutterCells } from "$lib/admin/sequenceGutter";
  import { provideRefPicker, type RefPickerRequest } from "$lib/admin/refPickerContext";
  import type { RefOptionsInput } from "$lib/admin/refOptions";
  import SequencePane from "./SequencePane.svelte";
  import StepEditor from "./StepEditor.svelte";
  import CsvAdvanced from "./CsvAdvanced.svelte";
  import ReferencePicker from "../refs/ReferencePicker.svelte";

  let { experimentId }: { experimentId: string } = $props();

  /** Error lines listed under the save button before the rest collapse into a count. */
  const MaxIssueLines = 8;
  const DefaultCondition = "Basic";
  /** Shown when a block-owned step's routine matches no design (a stale row). */
  const DefaultBlockLabel = "Session Design block";

  let rows = $state<SequenceRow[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let dirty = $state(false);
  let message = $state("");
  let failure = $state("");
  /** Sticky banner about routine defaults; survives later edits until dismissed. */
  let routineNotice = $state("");
  let addingTrials = $state(false);
  /** Why the last "Add trials" was refused; the dialog shows it. */
  let trialsRefusal = $state("");
  /** After an "Add trials" action: how to shuffle the new trials. Stays until dismissed. */
  let trialsNotice = $state("");
  /** True while the banner reports a rewrite that only the page's Save Changes persists. */
  let routineNoticeAwaitsExperimentSave = $state(false);
  let condition = $state(DefaultCondition);
  let selected = $state<number | null>(null);
  let pickerRequest = $state<RefPickerRequest | null>(null);
  /** The experiment's uploaded files: media cells and the stimulus picker find files here. */
  let assets = $state<AssetSummary[]>([]);

  const conditions = $derived($experiment.conditions.length > 0 ? $experiment.conditions : [DefaultCondition]);
  const routines = $derived($experiment.routines as RoutineConfig[]);
  // The switch and the config are independent, and the runtime reads the config
  // only when the switch is on: a stale range must not raise "shuffled range"
  // errors, nor draw brackets in the gutter, for a sequence that never shuffles.
  const randomization = $derived(
    $experiment.randomization ? (($experiment.randomizationConfig ?? null) as Record<string, RandomizationRange[]> | null) : null,
  );
  const ranges = $derived(randomization?.[condition] ?? []);
  const steps = $derived(stepsFor(rows, condition));
  const cells = $derived(gutterCells(steps, matchingBands(steps, routines), shuffledRanges(steps, ranges), routines));
  const validation = $derived(validateContentRows(rows, routines, conditions, randomization));
  const issues = $derived(new Map(steps.map((s) => [s.position, {
    errors: validation.rowErrors[s.rowIndex] ?? [],
    warnings: validation.rowWarnings[s.rowIndex] ?? [],
  }])));
  const errorLines = $derived(rows.flatMap((r, i) => (validation.rowErrors[i] ?? []).map((m) => `p${r.progress} (${r.condition}): ${m}`)));
  const errorSummary = $derived(
    errorLines.length === 1 ? "1 error blocks saving" : `${errorLines.length} errors block saving`,
  );
  const selectedStep = $derived(steps.find((s) => s.position === selected) ?? null);
  const pickerInput = $derived<RefOptionsInput | null>(
    pickerRequest ? { rows, condition, routines, ranges, from: selected, kind: pickerRequest.kind } : null,
  );

  provideRefPicker({ open: (request) => (pickerRequest = request) });

  // The page guards a tab switch with this: leaving unmounts the tab and the
  // local sequence goes with it. Nothing outside this component writes it.
  $effect(() => progressDirty.set(dirty));
  onDestroy(() => progressDirty.set(false));

  // The single-condition banner reports a routine-default rewrite that lives in
  // the experiment store and is persisted only by the page's Save Changes — so
  // it retires when THAT save lands (`dirty` goes false), not when this tab
  // saves the sequence. The multi-condition banner asks for a Builder edit no
  // save can make, so it stays until dismissed.
  $effect(() => {
    if (routineNoticeAwaitsExperimentSave && !$experiment.dirty) {
      routineNotice = "";
      routineNoticeAwaitsExperimentSave = false;
    }
  });

  onMount(async () => {
    condition = conditions[0];
    try {
      const listed = (await api.listContent(experimentId)) as Record<string, unknown>[];
      rows = listed.map((c) => ({
        progress: Number(c.progress ?? 0),
        trialNumber: Number(c.trialNumber ?? 1),
        routine: String(c.routine ?? ""),
        condition: String(c.condition ?? DefaultCondition),
        content: (c.content as Record<string, unknown>) ?? {},
        description: (c.description as string | null) ?? null,
      }));
    } catch (e) {
      failure = e instanceof api.ApiError ? e.message : "Failed to load the sequence";
    } finally {
      loading = false;
    }
    // A failed asset list must not block the tab: a media cell then reports
    // that no file has its name, which tells the researcher what is wrong.
    try {
      assets = (await api.listAssets(experimentId)).assets;
    } catch {
      assets = [];
    }
  });

  /**
   * Why this edit cannot be applied, or null. A block's rows are re-generated
   * from `SessionDesign.startProgress`, so renumbering them here would
   * desynchronise the next apply: the Session tab would rebuild them at the old
   * start and quietly undo the edit. The block has to move from the Session tab.
   */
  function blockShift(positionMap: Map<number, number>): string | null {
    const moved = steps.filter((s) => s.generated && positionMap.get(s.position) !== s.position);
    if (moved.length === 0) return null;
    const label = findOwningDesign(moved[0].routine, $experiment.sessionDesigns ?? [])?.label ?? DefaultBlockLabel;
    return `This edit would move the block-owned steps p${moved[0].position}–p${moved[moved.length - 1].position} (${label}); change the block's start in the Session tab instead.`;
  }

  /**
   * Commit an edit: rows, dirty flag, and the rewrite report (routines too,
   * when there is one condition).
   *
   * The routine-default remap is computed on every edit, never gated on
   * `result.rewritten` — that counts content-row rewrites, and a move or delete
   * whose rows carry no refs still renumbers positions and would leave routine
   * defaults pointing at the old ones. `remapRoutineRefs` reports 0 when the
   * map turns out to be an identity, so calling it unconditionally is free.
   * Applying it needs a single condition: the conditions reorder independently,
   * so one routine default cannot follow all of them — those are reported.
   */
  function apply(result: EditResult, select: number | null): boolean {
    const refusal = blockShift(result.positionMap);
    if (refusal) {
      failure = refusal;
      return false;
    }
    rows = result.rows;
    dirty = true;
    selected = select;
    failure = "";
    const notes: string[] = [];
    if (result.rewritten > 0) {
      notes.push(`${result.rewritten} reference${result.rewritten === 1 ? "" : "s"} rewritten`);
    }
    const remapped = remapRoutineRefs(routines, result.positionMap);
    if (remapped.rewritten > 0) {
      const plural = remapped.rewritten === 1 ? "" : "s";
      if (conditions.length === 1) {
        experiment.setField("routines", remapped.routines);
        notes.push(`${remapped.rewritten} in routine defaults — save the experiment to keep them`);
        routineNotice = `${remapped.rewritten} routine-default reference${plural} rewritten — save the experiment to keep them.`;
        routineNoticeAwaitsExperimentSave = true;
      } else {
        routineNotice = `${remapped.rewritten} routine-default reference${plural} in ${remapped.affected.join(", ")} point at positions this edit moved; they were left as authored because this experiment has ${conditions.length} conditions with different sequences — review them in the Builder.`;
        routineNoticeAwaitsExperimentSave = false;
      }
    }
    // Leave a standing message ("Saved") alone when this edit reports nothing.
    if (notes.length > 0) message = notes.join("; ");
    return true;
  }

  function addTrials(target: TrialTargetRef, values: unknown[], at: number) {
    const result = insertTrials(rows, condition, at, target, values);
    if (!apply(result, at)) {
      trialsRefusal = failure;
      trialsNotice = "";
      return;
    }
    addingTrials = false;
    const { from, to } = result.trials;
    const count = `${values.length} trial${values.length === 1 ? "" : "s"} added.`;
    trialsNotice = `${count} To shuffle these trials, add the trial range ${from}–${to} in Settings → Randomization.`;
  }

  const stepIndex = () => (selectedStep ? steps.indexOf(selectedStep) : -1);

  function add(routine: string) {
    apply(insertStep(rows, condition, steps.length, routine), steps.length);
  }
  function insert(where: "before" | "after") {
    const at = stepIndex() + (where === "after" ? 1 : 0);
    apply(insertStep(rows, condition, at, selectedStep!.routine), at);
  }
  // The step keeps its selection across an edit, so the new position must come
  // from the result's map rather than from a pre-renumber position.
  function move(direction: -1 | 1) {
    const target = steps[stepIndex() + direction];
    if (!target) return;
    const result = moveStep(rows, condition, selectedStep!.position, target.position);
    apply(result, result.positionMap.get(selectedStep!.position) ?? null);
  }
  function duplicate() {
    const result = duplicateStep(rows, condition, selectedStep!.position);
    // The copy is spliced directly after the original, so it renumbers to the
    // position right after wherever the original ended up.
    apply(result, (result.positionMap.get(selectedStep!.position) ?? -1) + 1);
  }
  /** A routine default has no position of its own; `dependantsOf` marks it -1. */
  const describeDependant = (d: Dependant) =>
    `${d.position < 0 ? "routine default" : `p${d.position}`} ${d.element} (${d.ref})`;
  function remove() {
    const result = deleteStep(rows, condition, selectedStep!.position, routines);
    if ("refused" in result) {
      failure = `Cannot delete p${selectedStep!.position}: referenced by ${result.refused.map(describeDependant).join(", ")}`;
      return;
    }
    if (!confirm(`Delete step p${selectedStep!.position}?`)) return;
    apply(result, null);
  }
  /**
   * An override belongs to the row the runtime will deliver, not to every row
   * sharing that progress: a step's extra-trial rows are alternatives, so
   * writing the edit to all of them would silently overwrite their own params.
   * `changeRoutine` deliberately differs — a routine swap must take the whole
   * step with it.
   */
  function setContent(content: Record<string, unknown>) {
    if (!selectedStep) return;
    const index = selectedStep.rowIndex;
    rows = rows.map((r, i) => (i === index ? { ...r, content } : r));
    dirty = true;
  }
  function setRoutine(routine: RoutineConfig) {
    if (!selectedStep) return;
    rows = changeRoutine(rows, condition, selectedStep.position, routine);
    dirty = true;
  }
  /**
   * Imported rows carry the file's own progress numbers, which may collide with
   * the sequence or leave gaps in it; the runtime only walks 0..n-1, so every
   * condition the file touches is renumbered and its refs remapped with it.
   */
  function importRows(imported: SequenceRow[]) {
    let next = [...rows, ...imported];
    let rewritten = 0;
    for (const c of new Set(imported.map((r) => r.condition))) {
      const result = renumber(next, c);
      next = result.rows;
      rewritten += result.rewritten;
    }
    rows = next;
    dirty = true;
    const rewrite = rewritten > 0 ? `, ${rewritten} reference${rewritten === 1 ? "" : "s"} rewritten` : "";
    message = `${imported.length} row${imported.length === 1 ? "" : "s"} imported${rewrite} — save to keep them`;
  }

  async function save() {
    if (rows.length === 0 && !confirm("Save an empty sequence? Every step will be removed.")) return;
    saving = true;
    failure = "";
    try {
      await api.saveContent(experimentId, rows);
      dirty = false;
      message = "Saved";
    } catch (e) {
      const body = e instanceof api.ApiError ? (e.body as { errors?: string[] } | undefined) : undefined;
      failure = body?.errors?.join("\n") ?? (e instanceof api.ApiError ? e.message : "Save failed");
    } finally {
      saving = false;
    }
  }
</script>

<div class="progress-tab">
  <div class="header">
    <h2>Progress</h2>
    {#if conditions.length > 1}
      <div class="conditions" role="tablist" aria-label="Condition">
        {#each conditions as c (c)}
          <button type="button" role="tab" aria-selected={condition === c} class:active={condition === c} onclick={() => { condition = c; selected = null; failure = ""; }}>{c}</button>
        {/each}
      </div>
    {/if}
    <span class="spacer"></span>
    {#if message}<span class="note">{message}</span>{/if}
    <button type="button" class="btn-save" disabled={saving || !dirty || errorLines.length > 0} onclick={save}>
      {saving ? "Saving…" : "Save sequence"}
    </button>
  </div>

  {#if errorLines.length > 0}
    <div class="errors" role="alert">
      <strong>{errorSummary}</strong>
      <ul>{#each errorLines.slice(0, MaxIssueLines) as line}<li>{line}</li>{/each}</ul>
      {#if errorLines.length > MaxIssueLines}<div>+{errorLines.length - MaxIssueLines} more</div>{/if}
    </div>
  {/if}
  {#if failure}<pre class="failure">{failure}</pre>{/if}
  {#if routineNotice}
    <div class="routine-notice">
      <span>{routineNotice}</span>
      <button type="button" onclick={() => { routineNotice = ""; routineNoticeAwaitsExperimentSave = false; }}>Dismiss</button>
    </div>
  {/if}

  {#if trialsNotice}
    <div class="routine-notice">
      <span>{trialsNotice}</span>
      <button type="button" onclick={() => (trialsNotice = "")}>Dismiss</button>
    </div>
  {/if}

  {#if loading}
    <p class="muted">Loading…</p>
  {:else}
    <div class="panes">
      <div class="left">
        <SequencePane {steps} {rows} {routines} {cells} {issues} {selected}
          onselect={(p) => { selected = p; failure = ""; }} onadd={add} onaddtrials={() => { trialsRefusal = ""; addingTrials = true; }} oninsert={insert} onmove={move} onduplicate={duplicate} ondelete={remove} />
        <CsvAdvanced {rows} {routines} {assets} {condition} nextProgress={steps.length} experimentName={$experiment.name} onimport={importRows} />
      </div>
      <div class="right">
        {#if selectedStep}
          {#key `${condition}:${selectedStep.position}`}
            <StepEditor step={selectedStep} routine={routines.find((r) => r.name === selectedStep.routine)} {routines}
              content={rows[selectedStep.rowIndex]?.content ?? {}} {experimentId}
              onchangecontent={setContent} onchangeroutine={setRoutine} />
          {/key}
        {:else}
          <p class="muted">Select a step to edit its parameters.</p>
        {/if}
      </div>
    </div>
  {/if}

  {#if addingTrials}
    <AddTrialsDialog {routines} {assets} endPosition={steps.length}
      belowPosition={selectedStep && !selectedStep.generated ? stepIndex() + 1 : null}
      refusal={trialsRefusal} onedit={() => (trialsRefusal = "")} onadd={addTrials} onclose={() => (addingTrials = false)} />
  {/if}

  {#if pickerRequest && pickerInput}
    <ReferencePicker input={pickerInput} onpick={pickerRequest.onpick} onclose={() => (pickerRequest = null)} />
  {/if}
</div>

<style>
  /* Every tab pads itself; the page's .tab-content shell does not. */
  .progress-tab { display: flex; flex-direction: column; gap: 12px; padding: 1.5rem; }
  .header { display: flex; align-items: center; gap: 12px; }
  h2 { margin: 0; font-size: 16px; }
  .conditions { display: flex; gap: 4px; }
  .conditions button { padding: 4px 10px; border: 1px solid var(--gray-200); background: #fff; font: inherit; font-size: 12px; cursor: pointer; }
  .conditions button.active { border-color: var(--black); }
  .spacer { flex: 1; }
  .note { font-size: 12px; color: var(--gray-500); }
  .btn-save { padding: 6px 14px; border: 1px solid var(--black); background: var(--black); color: #fff; font: inherit; cursor: pointer; }
  .btn-save:disabled { opacity: 0.4; cursor: not-allowed; }
  .errors { border: 1px solid var(--danger); padding: 8px 12px; font-size: 12px; }
  .errors ul { margin: 4px 0 0; padding-left: 18px; }
  .failure { color: var(--danger); font-size: 12px; white-space: pre-wrap; }
  .routine-notice { display: flex; align-items: baseline; gap: 12px; border: 1px solid var(--gray-200); padding: 8px 12px; font-size: 12px; }
  .routine-notice span { flex: 1; }
  .routine-notice button { border: 1px solid var(--gray-200); background: #fff; font: inherit; font-size: 12px; padding: 2px 8px; cursor: pointer; }
  .panes { display: grid; grid-template-columns: minmax(280px, 40%) 1fr; gap: 16px; align-items: start; }
  .right { border-left: 1px solid var(--gray-200); padding-left: 16px; min-height: 200px; }
  .muted { color: var(--gray-500); font-size: 13px; }
</style>
