<script lang="ts">
  import { validateRotation } from "ame-shared/interactionGroups";
  import { progressStride } from "$lib/admin/rotationSchedule";
  import SeatGroupsInput from "./SeatGroupsInput.svelte";
  import {
    appendTrial,
    removeTrial,
    seedStepsFromRoundRobin,
    MaxTrialCount,
  } from "$lib/admin/seatGroups";

  interface Props {
    /** 0-based `InteractionPattern.steps` — one entry per trial. */
    steps: number[][][];
    cohortSize: number;
    groupSize: number;
    /** Progress of the matching routine; trial 1 sits one progress after it. */
    startProgress: number;
    /** Set means a routine runs between trials, so each trial costs 2 progresses. */
    interTrialRoutine: string | null;
    onchange: (steps: number[][][]) => void;
  }

  let {
    steps,
    cohortSize,
    groupSize,
    startProgress,
    interTrialRoutine,
    onchange,
  }: Props = $props();

  const rotationIssue = $derived(validateRotation(cohortSize, groupSize));
  const stride = $derived(progressStride(interTrialRoutine));
  /** Seeding keeps the current trial count, or fills a full round-robin. */
  const seedCount = $derived(steps.length > 0 ? steps.length : cohortSize - 1);

  function updateTrial(index: number, groups: number[][]) {
    onchange(steps.map((step, i) => (i === index ? groups : step)));
  }
</script>

<div class="table">
  <div class="table-head">
    <span class="table-title">Trial pairings</span>
    <button
      class="seed"
      disabled={rotationIssue !== null}
      onclick={() => onchange(seedStepsFromRoundRobin(cohortSize, groupSize, seedCount))}
    >
      Seed from round-robin
    </button>
  </div>

  <div class="table-body">
    {#if rotationIssue}
      <p class="hint warn">{rotationIssue} — seeding is unavailable until the cohort and group size divide.</p>
    {/if}

    <div class="col-heads">
      <div>Trial</div>
      <div>Pairs</div>
      <div>Seats used</div>
      <div></div>
    </div>

    {#each steps as groups, index}
      <SeatGroupsInput
        {groups}
        {cohortSize}
        trialLabel={`T${index + 1}`}
        progress={startProgress + 1 + index * stride}
        onchange={(next) => updateTrial(index, next)}
        onremove={() => onchange(removeTrial(steps, index))}
      />
    {/each}

    <div class="add-row">
      <button
        class="add"
        disabled={steps.length >= MaxTrialCount}
        onclick={() => onchange(appendTrial(steps, cohortSize, groupSize))}
      >
        + Trial
      </button>
    </div>

    <p class="hint">
      Seats are written as you count them — 1 through {cohortSize}, not from zero.
      Pairs are separated by commas: 1-{cohortSize}, 2-{cohortSize - 1}.
    </p>
  </div>
</div>

<style>
  .table { background: #fff; display: flex; flex-direction: column; }
  .table-head { padding: 0.75rem 1rem; border-bottom: 1px solid var(--gray-200); display: flex; align-items: center; gap: 0.75rem; }
  .table-title { font-size: 12px; font-weight: 500; color: var(--gray-700); flex: 1; }
  .seed { font-size: 11px; padding: 0.3rem 0.6rem; border: 1px solid var(--gray-200); border-radius: var(--radius-sm); background: #fff; cursor: pointer; color: var(--gray-600); }
  .seed:hover:not(:disabled) { color: var(--black); border-color: var(--black); }
  .seed:disabled { cursor: not-allowed; color: var(--gray-400); }
  .table-body { padding: 1rem; display: flex; flex-direction: column; gap: 0.4rem; }
  .col-heads { display: grid; grid-template-columns: 88px 1fr 92px 28px; gap: 0.5rem; padding: 0 0.25rem 0.35rem; font-size: 11px; color: var(--gray-500); font-weight: 500; }
  .add-row { display: grid; grid-template-columns: 88px 1fr; gap: 0.5rem; margin-top: 0.35rem; }
  .add { grid-column: 2; justify-self: start; font-size: 11px; border: none; background: none; color: var(--gray-500); cursor: pointer; padding: 0.25rem 0; }
  .add:hover:not(:disabled) { color: var(--black); }
  .add:disabled { cursor: not-allowed; color: var(--gray-300); }
  .hint { margin: 0.75rem 0 0; font-size: 11px; color: var(--gray-500); line-height: 1.6; }
  .hint.warn { color: var(--accent); margin: 0 0 0.5rem; }
</style>
