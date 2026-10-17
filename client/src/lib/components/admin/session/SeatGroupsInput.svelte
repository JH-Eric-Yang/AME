<script lang="ts">
  import { readSeatRow, reseedRowText, trialSentenceLabel } from "$lib/admin/seatGroups";
  import { formatSeatGroups } from "ame-shared/sessionDesign";

  interface Props {
    /** 0-based groups for this trial, as stored. */
    groups: number[][];
    cohortSize: number;
    /** Compact column label, e.g. "T4". */
    trialLabel: string;
    /** Progress this trial compiles to, shown next to the label. */
    progress: number;
    onchange: (groups: number[][]) => void;
    onremove: () => void;
  }

  let { groups, cohortSize, trialLabel, progress, onchange, onremove }: Props = $props();

  /** What the researcher is typing. Filled by the effect below on mount. */
  let text = $state("");
  /**
   * The canonical text this row last agreed on with its parent. NOT $state:
   * the effect reads and writes it, and a rune would make that a self-dependency.
   */
  let syncedText = "";

  $effect(() => {
    const next = reseedRowText(syncedText, groups);
    if (next === null) return;
    syncedText = next;
    text = next;
  });

  const row = $derived(readSeatRow(text, cohortSize, trialLabel));
  const sentenceLabel = $derived(trialSentenceLabel(trialLabel));

  function handleInput(value: string) {
    text = value;
    const parsed = readSeatRow(value, cohortSize, trialLabel);
    if (!parsed.canEmit) return;
    // Record the canonical form so the echoed-back prop does not reset the input.
    syncedText = formatSeatGroups(parsed.groups);
    onchange(parsed.groups);
  }
</script>

<div class="seat-row-group">
  <div class="seat-row">
    <div class="trial">
      <span class="trial-name">{trialLabel}</span>
      <span class="trial-progress">p{progress}</span>
    </div>
    <input
      type="text"
      class="pairs"
      class:invalid={!row.badgeOk}
      value={text}
      placeholder="1-2, 3-4"
      aria-label={`${sentenceLabel} pairs`}
      oninput={(e) => handleInput(e.currentTarget.value)}
    />
    <div class="badge" class:invalid={!row.badgeOk} aria-label={`${row.badge} seats assigned`}>
      {row.badge}
    </div>
    <button class="remove" aria-label={`Remove ${sentenceLabel}`} onclick={onremove}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#cc0000" stroke-width="1.5" stroke-linecap="round">
        <path d="M4 4 L12 12" />
        <path d="M12 4 L4 12" />
      </svg>
    </button>
  </div>

  {#if row.headline || row.blockingIssues.length > 0}
    <div class="row-error">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#cc0000" stroke-width="1.5">
        <path d="M8 1.5 L15 14 H1 Z" stroke-linejoin="round" />
        <path d="M8 6 V9.5" />
        <circle cx="8" cy="11.75" r="0.75" fill="#cc0000" stroke="none" />
      </svg>
      <div>
        {#if row.headline}<div class="row-error-title">{row.headline}</div>{/if}
        {#if row.detail}<div class="row-error-detail">{row.detail}</div>{/if}
        {#each row.blockingIssues as issue}
          <div class="row-error-detail">{issue}</div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .seat-row-group { display: flex; flex-direction: column; gap: 0.35rem; }
  .seat-row { display: grid; grid-template-columns: 88px 1fr 92px 28px; gap: 0.5rem; align-items: center; }
  .trial { font-size: 12px; color: var(--gray-700); }
  .trial-name { font-weight: 500; }
  .trial-progress { font-family: monospace; font-size: 10px; color: var(--gray-400); margin-left: 0.25rem; }
  .pairs { width: 100%; padding: 0.35rem 0.5rem; border: 1px solid var(--gray-200); border-radius: var(--radius-sm); font-size: 12px; font-family: monospace; box-sizing: border-box; }
  .pairs:focus { outline: none; border-color: var(--black); }
  .pairs.invalid { border-color: var(--danger); }
  .pairs.invalid:focus { border-color: var(--danger); }
  .badge { font-size: 11px; color: var(--gray-500); }
  .badge.invalid { color: var(--danger); }
  .remove { border: none; background: none; cursor: pointer; padding: 0; line-height: 0; display: flex; align-items: center; justify-content: center; }
  .row-error { display: flex; gap: 0.5rem; align-items: flex-start; border: 1px solid var(--danger); border-radius: var(--radius-sm); background: var(--danger-dim); padding: 0.6rem 0.75rem; }
  .row-error svg { flex-shrink: 0; margin-top: 2px; }
  .row-error-title { font-size: 12px; color: var(--danger); font-weight: 500; }
  .row-error-detail { font-size: 11px; color: var(--gray-600); margin-top: 0.1rem; }
</style>
