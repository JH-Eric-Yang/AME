<script lang="ts">
  import { runner } from "$lib/stores/runner";

  // One line, dismissable, keyed by progress AND count: dismissing hides this
  // step's gaps, but a re-delivery of the same step with a different number of
  // them surfaces the notice again, while the same gap set stays dismissed.
  // Informational — the affected element has already rendered with an empty
  // value.
  const count = $derived($runner.unresolvedRefs.length);
  const key = $derived(`${$runner.progress}:${count}`);
  let dismissed = $state<string | null>(null);
  const open = $derived(count > 0 && dismissed !== key);
</script>

{#if open}
  <div class="refs-notice" role="status" aria-live="polite">
    <span class="refs-text">
      {count === 1 ? "One piece" : `${count} pieces`} of earlier data could not be loaded for this step.
    </span>
    <button type="button" class="refs-dismiss" aria-label="Dismiss" onclick={() => (dismissed = key)}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    </button>
  </div>
{/if}

<style>
  .refs-notice {
    position: fixed;
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.6rem 0.5rem 0.9rem;
    max-width: min(92vw, 34rem);
    border: 1px solid var(--gray-300);
    border-radius: 6px;
    background: var(--white);
    color: var(--gray-500);
    font-size: 13px;
  }
  .refs-text { flex: 1; }
  .refs-dismiss {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
    cursor: pointer;
    opacity: 0.55;
  }
  .refs-dismiss:hover,
  .refs-dismiss:focus-visible { opacity: 1; background: rgba(0, 0, 0, 0.06); }
</style>
