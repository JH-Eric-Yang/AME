<script lang="ts">
  import type { RoutineConfig } from "ame-shared";
  import type { SessionDesign, SessionDesignIssue } from "ame-shared/sessionDesign";
  import {
    PatternOptions,
    patternKindOf,
    groupSizeOf,
    groupSizeOptions,
    groupSizeLabel,
    fullRoundRobinTrials,
    isFullRoundRobin,
    routineOptions,
    interTrialRoutineOptions,
    buildScheduleGrid,
    patternPatch,
    groupSizePatch,
    trialsPatch,
    issuesForField,
    unplacedIssues,
    MinTrials,
    type PatternKind,
    type ScheduleField,
  } from "$lib/admin/rotationSchedule";
  import { correctedNumberText } from "$lib/admin/numberInput";
  import CoverageMatrix from "./CoverageMatrix.svelte";
  import ExplicitPairingTable from "./ExplicitPairingTable.svelte";

  interface Props {
    design: SessionDesign;
    routines: RoutineConfig[];
    conditions: string[];
    steps: number[][][];
    issues: SessionDesignIssue[];
    onchange: (patch: Partial<SessionDesign>) => void;
  }

  let { design, routines, conditions, steps, issues, onchange }: Props = $props();

  /** No between-trials routine; a select cannot carry null. */
  const NoRoutineValue = "";
  /** The lowest progress a block can start at. */
  const MinStartProgress = 1;

  let tab = $state<"schedule" | "coverage">("schedule");
  /** Set when the researcher unticks the box; see the note about lapsing pins. */
  let unpinned = $state(false);

  const kind = $derived(patternKindOf(design.pattern));
  const groupSize = $derived(groupSizeOf(design.pattern));
  const pinned = $derived(
    !unpinned && isFullRoundRobin(design.pattern, design.trials, design.cohortSize),
  );
  const grid = $derived(
    buildScheduleGrid(steps, design.cohortSize, design.startProgress, design.interTrialRoutine),
  );
  const trialRoutines = $derived(
    routineOptions(routines, "routine-video-chat", design.trialRoutine),
  );
  const interTrialRoutines = $derived(interTrialRoutineOptions(routines));
  const banner = $derived(unplacedIssues(issues));

  function selectPattern(next: PatternKind) {
    onchange(patternPatch(next, groupSize, steps));
  }

  function selectGroupSize(next: number) {
    onchange(groupSizePatch(kind, next, steps, design.cohortSize, pinned));
  }

  /**
   * A refused number must not stay on screen. Svelte rewrites `value={expr}`
   * only when `expr` changes, so an emptied or fractional Trials would leave
   * the field reading something the schedule never used — and this field is the
   * count of trials the participants actually run.
   */
  function setTrials(input: HTMLInputElement) {
    const patch = trialsPatch(Number(input.value));
    if (patch) onchange(patch);

    const corrected = correctedNumberText(input.value, patch?.trials ?? design.trials);
    if (corrected !== null) input.value = corrected;
  }

  function togglePin(checked: boolean) {
    unpinned = !checked;
    if (checked) onchange({ trials: fullRoundRobinTrials(design.cohortSize) });
  }

  function setStartProgress(input: HTMLInputElement) {
    const next = Number(input.value);
    const accepted = Number.isInteger(next) && next >= MinStartProgress;
    if (accepted) onchange({ startProgress: next });

    const corrected = correctedNumberText(input.value, accepted ? next : design.startProgress);
    if (corrected !== null) input.value = corrected;
  }

  function toggleCondition(condition: string, checked: boolean) {
    const next = checked
      ? [...design.conditions, condition]
      : design.conditions.filter((c) => c !== condition);
    onchange({ conditions: next });
  }
</script>

{#snippet fieldIssues(field: ScheduleField)}
  {#each issuesForField(issues, field) as issue}
    <span class="issue" class:warning={issue.level === "warning"}>{issue.message}</span>
  {/each}
{/snippet}

{#snippet scheduleGrid()}
  <div class="schedule-table">
    <table>
      <thead>
        <tr>
          <th class="seat-head">Seat</th>
          {#each grid.columns as column}
            <th>
              <div>{column.label}</div>
              <div class="progress-label">{column.progressLabel}</div>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each grid.rows as row}
          <tr>
            <td class="seat-label">{row.label}</td>
            {#each row.cells as cell}
              <td class="partner">{cell}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="table-note">
      Each cell is the seat this participant is paired with on that trial.
    </p>
  </div>
{/snippet}

<div class="schedule-pane">
  {#if banner.length > 0}
    <div class="banner">
      {#each banner as issue}
        <div class="issue" class:warning={issue.level === "warning"}>{issue.message}</div>
      {/each}
    </div>
  {/if}

  <div class="field-row">
    <label class="field">
      <span class="field-label">Pattern</span>
      <select value={kind} onchange={(e) => selectPattern(e.currentTarget.value as PatternKind)}>
        {#each PatternOptions as option}
          <option value={option.kind}>{option.label}</option>
        {/each}
      </select>
      {@render fieldIssues("pattern")}
    </label>

    <label class="field">
      <span class="field-label">Group size</span>
      <select
        value={String(groupSize)}
        disabled={kind !== "round-robin"}
        title={kind === "round-robin"
          ? ""
          : "This pattern stores its own groups; edit them in the table below."}
        onchange={(e) => selectGroupSize(Number(e.currentTarget.value))}
      >
        {#each groupSizeOptions(design.cohortSize) as size}
          <option value={String(size)}>{groupSizeLabel(size)}</option>
        {/each}
      </select>
    </label>

    <div class="field">
      <span class="field-label">Trials</span>
      <div class="trials-row">
        <input
          type="number"
          class="trials-input"
          min={MinTrials}
          aria-label="Trials"
          value={design.trials}
          disabled={pinned}
          onchange={(e) => setTrials(e.currentTarget)}
        />
        <label class="checkbox">
          <input
            type="checkbox"
            checked={pinned}
            onchange={(e) => togglePin(e.currentTarget.checked)}
          />
          full round-robin
        </label>
      </div>
      {@render fieldIssues("trials")}
    </div>
  </div>

  <div class="field-row">
    <label class="field">
      <span class="field-label">Trial routine</span>
      <select
        value={design.trialRoutine}
        onchange={(e) => onchange({ trialRoutine: e.currentTarget.value })}
      >
        {#each trialRoutines as name}
          <option value={name}>{name}</option>
        {/each}
      </select>
      {@render fieldIssues("trialRoutine")}
    </label>

    <label class="field">
      <span class="field-label">Between trials</span>
      <select
        value={design.interTrialRoutine ?? NoRoutineValue}
        onchange={(e) => onchange({ interTrialRoutine: e.currentTarget.value || null })}
      >
        <option value={NoRoutineValue}>none</option>
        {#each interTrialRoutines as name}
          <option value={name}>{name}</option>
        {/each}
      </select>
      {@render fieldIssues("interTrialRoutine")}
    </label>

    <label class="field">
      <span class="field-label">Start at progress</span>
      <input
        type="number"
        min={MinStartProgress}
        value={design.startProgress}
        onchange={(e) => setStartProgress(e.currentTarget)}
      />
    </label>
  </div>

  <fieldset class="conditions">
    <legend>Conditions</legend>
    {#each conditions as condition}
      <label class="checkbox">
        <input
          type="checkbox"
          checked={design.conditions.includes(condition)}
          onchange={(e) => toggleCondition(condition, e.currentTarget.checked)}
        />
        {condition}
      </label>
    {/each}
    {@render fieldIssues("conditions")}
  </fieldset>

  <div class="pane-tabs">
    <button class="pane-tab" class:active={tab === "schedule"} onclick={() => (tab = "schedule")}>
      Schedule
    </button>
    <button class="pane-tab" class:active={tab === "coverage"} onclick={() => (tab = "coverage")}>
      Coverage
    </button>
  </div>

  <div class="tab-panel">
    {#if tab === "coverage"}
      <CoverageMatrix {steps} cohortSize={design.cohortSize} />
    {:else if kind === "sequence"}
      <ExplicitPairingTable
        {steps}
        cohortSize={design.cohortSize}
        {groupSize}
        startProgress={design.startProgress}
        interTrialRoutine={design.interTrialRoutine}
        onchange={(next) =>
          onchange({ ...patternPatch("sequence", groupSize, next), trials: next.length })}
      />
    {:else}
      {@render scheduleGrid()}
    {/if}
  </div>
</div>

<style>
  .schedule-pane { flex: 1; padding: 1rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.75rem; min-width: 0; }
  .field-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.75rem; }
  .field { display: block; margin: 0; }
  .field-label { display: block; font-size: 12px; font-weight: 500; margin-bottom: 0.15rem; color: var(--gray-700); }
  input[type="number"], select { width: 100%; padding: 0.35rem 0.5rem; border: 1px solid var(--gray-200); border-radius: var(--radius-sm); font-size: 13px; box-sizing: border-box; }
  input:focus, select:focus { outline: none; border-color: var(--black); }
  select:disabled { background: var(--white); color: var(--gray-500); }
  .trials-row { display: flex; align-items: center; gap: 0.4rem; }
  .trials-input { width: 64px; }
  .checkbox { display: flex; align-items: center; gap: 0.25rem; font-size: 11px; color: var(--gray-600); margin: 0; }
  .checkbox input { margin: 0; width: auto; }
  fieldset.conditions { border: 1px solid var(--gray-200); border-radius: var(--radius-sm); padding: 0.5rem 0.75rem; display: flex; flex-wrap: wrap; gap: 0.75rem; }
  legend { font-size: 12px; font-weight: 500; padding: 0 0.25rem; }
  .banner { display: flex; flex-direction: column; gap: 0.25rem; }
  .issue { display: block; font-size: 11px; color: var(--danger); margin-top: 0.15rem; }
  .issue.warning { color: var(--accent); }
  .pane-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--gray-200); margin-top: 0.25rem; }
  .pane-tab { font-size: 12px; padding: 0.5rem 1rem; border: 1px solid var(--gray-200); border-bottom: none; border-radius: var(--radius-sm) 4px 0 0; background: var(--gray-50); cursor: pointer; color: var(--gray-500); margin-bottom: -1px; }
  .pane-tab.active { background: #fff; color: var(--black); font-weight: 500; border-bottom: 1px solid #fff; }
  .tab-panel { border: 1px solid var(--gray-200); border-top: none; border-radius: 0 0 3px 3px; overflow-x: auto; }
  .schedule-table { padding: 0.75rem; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid var(--gray-200); padding: 0.4rem 0.5rem; }
  th { background: var(--gray-50); font-weight: 500; font-size: 11px; color: var(--gray-600); white-space: nowrap; text-align: center; }
  th.seat-head { text-align: left; }
  .progress-label { font-family: monospace; font-size: 10px; color: var(--gray-400); font-weight: 400; }
  .seat-label { text-align: left; font-size: 12px; color: var(--gray-700); white-space: nowrap; }
  .partner { text-align: center; font-size: 12px; font-family: monospace; color: var(--black); }
  .table-note { margin: 0.6rem 0 0; font-size: 11px; color: var(--gray-500); }
</style>
