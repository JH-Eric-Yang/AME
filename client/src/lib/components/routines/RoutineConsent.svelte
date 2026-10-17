<script lang="ts">
  import { runner } from "$lib/stores/runner";
  import * as socket from "$lib/socket/experimentSocket";
  import LayoutGrid from "./LayoutGrid.svelte";

  const config = $derived($runner.routine?.config as {
    agreeLabel?: string;
    disagreeLabel?: string;
    withdrawOnDisagree?: boolean;
  } | undefined);

  const gridLayout = $derived($runner.routine?.layout ?? null);

  function handleAgree() {
    socket.emitConsent();
    socket.emitProceed();
  }

  function handleDisagree() {
    if (config?.withdrawOnDisagree !== false) {
      socket.emitWithdraw();
    }
  }
</script>

<div class="consent-wrapper">
  <div class="consent-card">
    {#if gridLayout}
      <LayoutGrid layout={gridLayout} elements={$runner.elements} />
    {/if}

    <div class="consent-actions">
      <button class="btn-primary" onclick={handleAgree}>
        {config?.agreeLabel ?? "I Agree"}
      </button>
      <button class="btn-secondary" onclick={handleDisagree}>
        {config?.disagreeLabel ?? "I Do Not Agree"}
      </button>
    </div>
  </div>
</div>

<style>
  .consent-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 1rem;
  }
  .consent-card {
    max-width: 700px;
    width: 100%;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-sm);
    padding: 2rem;
  }
  .consent-actions {
    display: flex;
    gap: 1rem;
    justify-content: center;
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 1px solid var(--gray-200);
  }
  .btn-primary {
    background: var(--black);
    color: #fff;
    padding: 0.75rem 2rem;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 14px;
    cursor: pointer;
  }
  .btn-secondary {
    background: #fff;
    color: var(--black);
    padding: 0.75rem 2rem;
    border: 1px solid var(--black);
    border-radius: var(--radius-sm);
    font-size: 14px;
    cursor: pointer;
  }
</style>
