<script lang="ts">
  import type { DriftEntry } from "ame-shared/sessionDesign";
  import { driftHeadline } from "ame-shared/blockOwnership";

  interface Props {
    entries: DriftEntry[];
    /**
     * Why Adopt cannot run, or null when it can. A difference adoption has no
     * value to take — a routine the Builder no longer holds, or one of the
     * wrong type — must not leave a button that looks live and does nothing.
     */
    adoptDisabledReason: string | null;
    onadopt: () => void;
    onoverwrite: () => void;
  }

  let { entries, adoptDisabledReason, onadopt, onoverwrite }: Props = $props();
</script>

{#if entries.length > 0}
  <div class="drift-strip">
    <div class="drift-body">
      <div class="drift-headline">{driftHeadline(entries)}</div>
      {#each entries as entry (`${entry.routineName}:${entry.field}`)}
        <div class="drift-line">{entry.message}</div>
      {/each}
      {#if adoptDisabledReason}
        <div class="drift-line adopt-blocked">{adoptDisabledReason}</div>
      {/if}
    </div>
    <div class="drift-actions">
      <button
        class="drift-secondary"
        disabled={adoptDisabledReason !== null}
        title={adoptDisabledReason ?? ""}
        onclick={onadopt}
      >
        Adopt from Builder
      </button>
      <button class="drift-primary" onclick={onoverwrite}>Overwrite from Design</button>
    </div>
  </div>
{/if}

<style>
  .drift-strip { display: flex; align-items: center; gap: 1rem; border: 1px solid var(--gray-300); border-radius: var(--radius-sm); background: var(--gray-100); padding: 0.75rem 1rem; }
  .drift-body { flex: 1; min-width: 0; }
  .drift-headline { font-size: 12px; color: var(--gray-700); font-weight: 500; }
  .drift-line { font-size: 11px; color: var(--gray-600); margin-top: 0.1rem; }
  .drift-actions { display: flex; gap: 0.4rem; flex-shrink: 0; }
  .drift-secondary, .drift-primary { font-size: 12px; padding: 0.4rem 0.75rem; border-radius: var(--radius-sm); cursor: pointer; font-family: inherit; white-space: nowrap; }
  .drift-secondary { border: 1px solid var(--gray-200); background: #fff; color: var(--gray-700); }
  .drift-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
  .adopt-blocked { color: var(--accent); margin-top: 0.3rem; }
  .drift-primary { border: 1px solid var(--black); background: var(--black); color: #fff; }
</style>
