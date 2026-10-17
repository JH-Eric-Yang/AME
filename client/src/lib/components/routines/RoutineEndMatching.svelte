<script lang="ts">
  import { onMount } from "svelte";
  import { runner } from "$lib/stores/runner";
  import * as socket from "$lib/socket/experimentSocket";

  let closing = $state(true);

  onMount(() => {
    // Close the active session and proceed immediately
    runner.setMatched("", [], 0, "");
    socket.emitProceed();
    closing = false;
  });
</script>

<div class="end-matching-container">
  {#if closing}
    <p class="status-text">Ending matching session...</p>
  {:else}
    <p class="status-text">Proceeding...</p>
  {/if}
</div>

<style>
  .end-matching-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 200px;
  }
  .status-text {
    font-size: 14px;
    color: var(--gray-500);
  }
</style>
