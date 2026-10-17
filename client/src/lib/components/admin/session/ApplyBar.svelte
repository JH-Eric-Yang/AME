<script lang="ts">
  import type { CompiledBlock, SessionDesignIssue } from "ame-shared/sessionDesign";
  import { describeApplyBar, type ApplyState } from "$lib/admin/applyBarView";

  interface Props {
    compiled: CompiledBlock;
    issues: SessionDesignIssue[];
    state: ApplyState;
    /**
     * Whether a Generate & Save is still running. Locks the button even when an
     * edit made mid-write has reset `state` to `idle`.
     */
    inFlight: boolean;
    /** Every routine name the Builder currently holds, so `+` and `~` are facts. */
    routineNames: string[];
    /**
     * The single action the bar offers. The tab routes it: from `idle` it runs
     * both writes, from `routines-only` it retries the content upload alone.
     */
    onapply: () => void;
    /** Switches the page to the Content tab after a successful apply. */
    onviewcontent: () => void;
  }

  let { compiled, issues, state, inFlight, routineNames, onapply, onviewcontent }: Props =
    $props();

  const view = $derived(describeApplyBar(compiled, issues, state, routineNames, inFlight));
</script>

<div class="apply-bar" class:blocked={view.status === "blocked"}>
  <div class="plan">
    {#if view.items.length > 0}
      <div class="items">
        {#each view.items as item, index}
          {#if index > 0}<span class="sep">·</span>{/if}
          <span>
            <span class="verb">{item.verb} {item.name}</span>
            {#if item.detail}<span class="qualifier">{item.detail}</span>{/if}
          </span>
        {/each}
      </div>
    {/if}

    <div class="line">
      {#if view.status === "blocked"}
        <svg
          class="icon"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="#cc0000"
          stroke-width="1.5"
          aria-hidden="true"
        >
          <path d="M8 1.5 L15 14 H1 Z" stroke-linejoin="round" />
          <path d="M8 6 V9.5" />
          <circle cx="8" cy="11.75" r="0.75" fill="#cc0000" stroke="none" />
        </svg>
      {:else if view.status === "applied"}
        <svg
          class="icon"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="#0a0a0a"
          stroke-width="1.75"
          aria-hidden="true"
        >
          <path d="M3 8.5 L6.5 12 L13 4.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      {/if}

      <div class="words">
        <div class="summary" class:error={view.status === "blocked"}>{view.summary}</div>
        {#if view.detail}<div class="detail">{view.detail}</div>{/if}
      </div>
    </div>
  </div>

  {#if view.action.kind === "view-content"}
    <button class="btn-ghost" onclick={onviewcontent}>{view.action.label}</button>
  {:else}
    <button
      class="btn-dark"
      class:compact={view.action.kind === "retry-upload"}
      disabled={view.action.disabled}
      onclick={onapply}
    >
      {view.action.label}
    </button>
  {/if}
</div>

<style>
  .apply-bar {
    display: flex;
    align-items: center;
    gap: 1rem;
    border-top: 1px solid var(--gray-200);
    background: var(--gray-50);
    padding: 0.75rem 1rem;
  }

  .apply-bar.blocked {
    border-top-color: var(--danger);
    background: var(--danger-dim);
  }

  .plan {
    flex: 1;
    min-width: 0;
  }

  .items {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;
    font-size: 12px;
    color: var(--gray-700);
    margin-bottom: 0.15rem;
  }

  .verb {
    font-weight: 500;
  }

  .qualifier {
    color: var(--gray-500);
  }

  .sep {
    color: var(--gray-300);
  }

  .line {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .icon {
    flex-shrink: 0;
    margin-top: 3px;
  }

  .words {
    min-width: 0;
  }

  .summary {
    font-size: 12px;
    color: var(--gray-700);
  }

  .summary.error {
    color: var(--danger);
    font-weight: 500;
  }

  .detail {
    font-size: 11px;
    color: var(--gray-600);
    margin-top: 0.1rem;
  }

  .btn-dark {
    background: var(--black);
    color: #fff;
    padding: 0.5rem 1rem;
    border: 1px solid var(--black);
    border-radius: var(--radius-sm);
    font-size: 14px;
    font-family: inherit;
    white-space: nowrap;
    cursor: pointer;
  }

  .btn-dark.compact {
    padding: 0.4rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 12px;
  }

  .btn-dark:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-ghost {
    background: #fff;
    color: var(--gray-700);
    padding: 0.4rem 0.75rem;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-sm);
    font-size: 12px;
    font-family: inherit;
    white-space: nowrap;
    cursor: pointer;
  }
</style>
