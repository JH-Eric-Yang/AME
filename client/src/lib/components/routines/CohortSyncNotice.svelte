<script lang="ts">
  import { runner } from "$lib/stores/runner";
  import { cohortNotice, showsCohortNotice, noticeKey } from "$lib/matching/cohortSync";

  // `proceedRequested` is this participant's own record that they asked to
  // advance; the server sends a count and nothing about who. It is cleared by
  // setContent, which is also what clears cohortSync, so the two never disagree.
  const active = $derived(showsCohortNotice($runner.routine?.type));
  const notice = $derived(
    active ? cohortNotice($runner.cohortSync, $runner.proceedRequested) : null,
  );
  const key = $derived(
    active ? noticeKey($runner.cohortSync, $runner.proceedRequested) : null,
  );

  let dismissed = $state<string | null>(null);
  const open = $derived(notice !== null && key !== dismissed);
</script>

{#if open}
  <!-- Fixed, so it never moves the routine underneath it: this arrives while
       the participant is reading the screen, and reflowing the whole page to
       make room for one line was worse than the news is worth. -->
  <div class="cohort-popup" class:waiting={notice!.waiting} role="status" aria-live="polite">
    {#if notice!.waiting}
      <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
    {/if}
    <span class="cohort-text">{notice!.text}</span>
    <button
      type="button"
      class="cohort-dismiss"
      aria-label="Dismiss"
      onclick={() => (dismissed = key)}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    </button>
  </div>
{/if}

<style>
  .cohort-popup {
    position: fixed;
    top: 1rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 0.75rem 0.6rem 1rem;
    max-width: min(92vw, 34rem);
    border: 1px solid var(--black);
    border-radius: 6px;
    background: var(--white);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
    font-size: 14px;
    animation: drop-in 0.18s ease-out;
  }
  /* The participant being waited ON is the one who still has to act, so their
     popup is the loud one. */
  .cohort-popup.waiting {
    border-color: var(--gray-300);
    color: var(--gray-500);
  }
  .cohort-text {
    flex: 1;
  }
  .cohort-dismiss {
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
  .cohort-dismiss:hover,
  .cohort-dismiss:focus-visible {
    opacity: 1;
    background: rgba(0, 0, 0, 0.06);
  }
  .dots {
    display: inline-flex;
    gap: 3px;
  }
  .dots i {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: currentColor;
    animation: pulse 1.2s ease-in-out infinite;
  }
  .dots i:nth-child(2) { animation-delay: 0.15s; }
  .dots i:nth-child(3) { animation-delay: 0.3s; }
  @keyframes pulse {
    0%, 100% { opacity: 0.25; }
    50% { opacity: 1; }
  }
  @keyframes drop-in {
    from { opacity: 0; transform: translate(-50%, -8px); }
    to { opacity: 1; transform: translate(-50%, 0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .cohort-popup { animation: none; }
    .dots i { animation: none; opacity: 0.6; }
  }
</style>
