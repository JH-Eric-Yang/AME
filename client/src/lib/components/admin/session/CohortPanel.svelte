<script lang="ts">
  import type { PropertyFilter } from "ame-shared";
  import type { SessionDesign, SessionDesignIssue } from "ame-shared/sessionDesign";
  import { MinSlotCount, MaxSlotCount } from "$lib/admin/slotEditing";
  import {
    DefaultTimeoutSeconds,
    applyAssignmentField,
    applyAssignmentMode,
    applyCohortSize,
    applyTimeoutSeconds,
    issuesForField,
    matchingForDesign,
    renameSeat,
    seatFilterLabel,
    setSeatFilters,
    timeoutWarning,
  } from "$lib/admin/cohortEditing";
  import { describeAssignment } from "$lib/admin/roleAssignmentCopy";
  import { validateRoleAssignment } from "ame-shared/roleAssignment";
  import { correctedNumberText } from "$lib/admin/numberInput";
  import PropertyFilterEditor from "../canvas/PropertyFilterEditor.svelte";

  interface Props {
    design: SessionDesign;
    issues: SessionDesignIssue[];
    onchange: (patch: Partial<SessionDesign>) => void;
  }

  let { design, issues, onchange }: Props = $props();

  /** Seat whose filter disclosure is expanded; null when all are collapsed. */
  let openSeat = $state<number | null>(null);

  const Strategies: { value: SessionDesign["strategy"]; label: string }[] = [
    { value: "fifo", label: "FIFO" },
    { value: "property", label: "Property" },
    { value: "manual", label: "Manual" },
  ];

  const TimeoutActions: { value: SessionDesign["timeoutAction"]; label: string }[] = [
    { value: "wait", label: "Keep waiting" },
    { value: "proceed", label: "Proceed solo" },
  ];

  const timeoutHint = $derived(timeoutWarning(design.timeoutSeconds));

  /** What this block will actually compile onto its matching routine. */
  const matching = $derived(matchingForDesign(design));
  const assignmentRefusal = $derived(validateRoleAssignment(matching));

  function toggleSeat(index: number) {
    openSeat = openSeat === index ? null : index;
  }

  function handleSeatFilters(index: number, filters: PropertyFilter[]) {
    onchange({ seats: setSeatFilters(design.seats, index, filters) });
  }

  /**
   * Show what the design took, not what was typed.
   *
   * `value={design.cohortSize}` is rewritten only when the NUMBER changes, so a
   * cleared or clamped field would otherwise keep its text while the block —
   * and the apply bar's "sets Participants Per Session to N" — used the old
   * value. The two must never disagree on this screen.
   */
  function setCohortSize(input: HTMLInputElement) {
    const patch = applyCohortSize(design.seats, Number.parseInt(input.value, 10));
    onchange(patch);

    const corrected = correctedNumberText(input.value, patch.cohortSize);
    if (corrected !== null) input.value = corrected;
  }

  function setTimeoutSeconds(input: HTMLInputElement) {
    const patch = applyTimeoutSeconds(input.value);
    onchange(patch);

    const accepted = patch.timeoutSeconds ?? design.timeoutSeconds;
    const corrected = correctedNumberText(input.value, accepted);
    if (corrected !== null) input.value = corrected;
  }
</script>

<div class="cohort-panel">
  <h4>Cohort</h4>

  <label>
    <span>Cohort size</span>
    <input
      type="number"
      value={design.cohortSize}
      min={MinSlotCount}
      max={MaxSlotCount}
      step="1"
      onchange={(e) => setCohortSize(e.currentTarget)}
    />
  </label>
  {#each issuesForField(issues, "cohortSize") as issue}
    <p class="config-hint" class:warn={issue.level === "warning"} class:error={issue.level === "error"}>{issue.message}</p>
  {/each}

  <label>
    <span>Strategy</span>
    <select
      value={design.strategy}
      onchange={(e) => {
        const strategy = e.currentTarget.value as SessionDesign["strategy"];
        // Property matching's filters decide placement, so an assignment held
        // under it is refused at save. Drop it with the switch rather than
        // leave the block unsaveable for a reason the researcher cannot see.
        onchange(
          strategy === "property"
            ? { strategy, assignment: undefined }
            : { strategy },
        );
      }}
    >
      {#each Strategies as strategy}
        <option value={strategy.value}>{strategy.label}</option>
      {/each}
    </select>
  </label>

  {#if design.strategy !== "property"}
    <label>
      <span>Role assignment</span>
      <select
        value={design.assignment?.mode ?? "random"}
        onchange={(e) => onchange(applyAssignmentMode(e.currentTarget.value))}
      >
        <option value="random">Random</option>
        <option value="counterbalanced">Counterbalanced</option>
      </select>
    </label>

    {#if design.assignment?.mode === "counterbalanced"}
      {@const cb = design.assignment}
      <div class="pair">
        <label>
          <span>Permutations</span>
          <select
            value={cb.set}
            onchange={(e) =>
              onchange(
                applyAssignmentField(cb, {
                  set: e.currentTarget.value as "rotation" | "permutation",
                }),
              )}
          >
            <option value="rotation">Rotation</option>
            <option value="permutation">Complete</option>
          </select>
        </label>
        <label>
          <span>Order</span>
          <select
            value={cb.order}
            onchange={(e) =>
              onchange(
                applyAssignmentField(cb, {
                  order: e.currentTarget.value as "sequential" | "block-shuffled",
                }),
              )}
          >
            <option value="sequential">Sequential</option>
            <option value="block-shuffled">Block-shuffled</option>
          </select>
        </label>
      </div>
    {/if}
  {/if}

  <p class="config-hint">{describeAssignment(matching)}</p>
  {#if assignmentRefusal}
    <p class="config-hint error">{assignmentRefusal}</p>
  {/if}

  <div class="pair">
    <label>
      <span>Timeout (s)</span>
      <input
        type="number"
        value={design.timeoutSeconds}
        placeholder={String(DefaultTimeoutSeconds)}
        min="0"
        step="1"
        onchange={(e) => setTimeoutSeconds(e.currentTarget)}
      />
    </label>
    <label>
      <span>On timeout</span>
      <select
        value={design.timeoutAction}
        onchange={(e) => onchange({ timeoutAction: e.currentTarget.value as SessionDesign["timeoutAction"] })}
      >
        {#each TimeoutActions as action}
          <option value={action.value}>{action.label}</option>
        {/each}
      </select>
    </label>
  </div>
  {#if timeoutHint}
    <p class="config-hint warn">{timeoutHint}</p>
  {/if}

  <fieldset>
    <legend>Seats ({design.cohortSize})</legend>
    {#each design.seats as seat, index}
      <div class="seat-row">
        <span class="mono seat-number">{index + 1}</span>
        <input
          type="text"
          class="seat-name"
          value={seat.name}
          oninput={(e) => onchange({ seats: renameSeat(design.seats, index, e.currentTarget.value) })}
        />
        <button class="btn-seat-filters" onclick={() => toggleSeat(index)}>
          {seatFilterLabel(seat, openSeat === index)}
        </button>
      </div>
      {#if openSeat === index}
        <div class="seat-filters">
          <PropertyFilterEditor
            filters={seat.filters ?? []}
            onchange={(filters) => handleSeatFilters(index, filters)}
          />
        </div>
      {/if}
    {/each}
    {#each issuesForField(issues, "seats") as issue}
      <p class="config-hint" class:warn={issue.level === "warning"} class:error={issue.level === "error"}>{issue.message}</p>
    {/each}
  </fieldset>

  <fieldset>
    <legend>If a partner drops</legend>
    <p class="drop-note">
      The session continues. The orphaned participant sits out that trial and rejoins at the next one.
    </p>
    <label>
      <span>Notice shown</span>
      <textarea
        rows="2"
        value={design.partnerUnavailableText}
        oninput={(e) => onchange({ partnerUnavailableText: e.currentTarget.value })}
      ></textarea>
    </label>
    {#each issuesForField(issues, "partnerUnavailableText") as issue}
      <p class="config-hint" class:warn={issue.level === "warning"} class:error={issue.level === "error"}>{issue.message}</p>
    {/each}
  </fieldset>
</div>

<style>
  .cohort-panel { width: 280px; border-right: 1px solid var(--gray-200); padding: 1rem; overflow-y: auto; }
  h4 { font-size: 14px; font-weight: 600; margin: 0 0 0.75rem; }
  label { display: block; margin-bottom: 0.5rem; }
  label span { display: block; font-size: 12px; font-weight: 500; margin-bottom: 0.15rem; color: var(--gray-700); }
  input[type="text"], input[type="number"], textarea, select { width: 100%; padding: 0.35rem 0.5rem; border: 1px solid var(--gray-200); border-radius: var(--radius-sm); font-size: 13px; box-sizing: border-box; }
  input:focus, textarea:focus, select:focus { outline: none; border-color: var(--black); }
  textarea { font-family: inherit; font-size: 12px; resize: none; }
  fieldset { border: 1px solid var(--gray-200); border-radius: var(--radius-sm); padding: 0.75rem; margin-top: 0.75rem; }
  legend { font-size: 12px; font-weight: 500; padding: 0 0.25rem; }
  .pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem; }
  .mono { font-family: monospace; font-size: 12px; }
  .seat-row { display: flex; align-items: center; gap: 0.35rem; padding: 0.15rem 0; }
  .seat-number { font-size: 11px; color: var(--gray-400); width: 14px; flex-shrink: 0; }
  .seat-name { flex: 1; min-width: 0; padding: 0.25rem 0.4rem; font-size: 12px; }
  .btn-seat-filters { font-size: 11px; border: none; background: none; color: var(--gray-500); cursor: pointer; padding: 0 0.15rem; flex-shrink: 0; white-space: nowrap; }
  .btn-seat-filters:hover { color: var(--black); }
  .seat-filters { padding: 0.15rem 0 0.35rem 1.05rem; }
  .drop-note { margin: 0 0 0.4rem; font-size: 11px; color: var(--gray-500); line-height: 1.5; }
  .config-hint { font-size: 12px; color: var(--gray-500); margin: 0.25rem 0 0; }
  .config-hint.warn { color: var(--accent); }
  .config-hint.error { color: var(--danger); }
</style>
