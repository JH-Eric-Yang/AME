<script lang="ts">
  import { onMount } from "svelte";
  import { runner } from "$lib/stores/runner";
  import * as socket from "$lib/socket/experimentSocket";
  import { shouldEmitMatchJoin } from "$lib/matching/shouldJoinMatching";

  let emitted = $state(false);

  onMount(() => {
    const { routine, sessionId } = $runner;
    if (routine && shouldEmitMatchJoin(routine, sessionId, emitted)) {
      socket.emitMatchJoin(routine.name);
      emitted = true;
    }
  });

  // Auto-proceed when matched (state transitions from MATCHING to RUNNING)
  $effect(() => {
    if ($runner.sessionId && $runner.state === "RUNNING") {
      socket.emitProceed();
    }
  });
</script>

<div class="matching-container">
  {#if $runner.matchingStatus}
    <div class="matching-status">
      <div class="spinner"></div>
      <p class="waiting-text">Waiting for other participants...</p>
      <p class="count">{$runner.matchingStatus.current} of {$runner.matchingStatus.target} ready</p>
    </div>
  {:else}
    <div class="matching-status">
      <div class="spinner"></div>
      <p class="waiting-text">Connecting...</p>
    </div>
  {/if}
</div>

<style>
  .matching-container {
    display: flex;
    justify-content: center;
    align-items: center;
    /* Centred on the PAGE, not in a 300px box near the top: this is a
       full-screen wait, and the routine renders straight into `.runner` with
       no centring wrapper of its own. */
    min-height: 100vh;
    padding: 2rem;
  }
  .matching-status {
    text-align: center;
  }
  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--gray-200);
    border-top-color: var(--black);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 1rem;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .waiting-text {
    font-size: 16px;
    font-weight: 500;
    margin: 0 0 0.5rem;
  }
  .count {
    font-size: 14px;
    color: var(--gray-500);
    margin: 0;
  }
</style>
