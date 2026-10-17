<script lang="ts">
  import { onMount } from "svelte";
  import { resolveFinishMode, type RoutineEndConfig } from "ame-shared";
  import { runner } from "$lib/stores/runner";
  import * as socket from "$lib/socket/experimentSocket";
  import LayoutGrid from "./LayoutGrid.svelte";

  /** Redirect anyway if the server never confirms, so nobody is stranded here. */
  const RedirectFallbackMs = 5000;

  const config = $derived(($runner.routine?.config ?? {}) as RoutineEndConfig);
  const finishMode = $derived(resolveFinishMode(config));
  const redirects = $derived(finishMode !== "debrief");

  const gridLayout = $derived($runner.routine?.layout ?? null);

  let submitting = $state(false);

  /**
   * Complete the experiment, then leave for the redirect URL once the server
   * confirms. Redirecting first can land the participant on the completion
   * page while the server still has them marked incomplete.
   */
  function complete() {
    if (submitting) return;
    submitting = true;

    // Debrief mode never redirects, even if a URL is left over from a previous
    // configuration.
    const url = redirects ? config.redirectUrl : null;
    socket.emitComplete();

    // Without a redirect the runner shows its own completed screen on
    // confirmation, so there is nothing more to do here.
    if (!url) return;

    let done = false;
    const leave = () => {
      if (done) return;
      done = true;
      window.location.href = url;
    };

    const unsubscribe = runner.subscribe((state) => {
      if (state.state === "COMPLETED") leave();
    });

    setTimeout(() => {
      unsubscribe();
      leave();
    }, RedirectFallbackMs);
  }

  // redirect-only shows no debrief: complete and leave as soon as we arrive.
  onMount(() => {
    if (finishMode === "redirect-only") complete();
  });
</script>

{#if finishMode === "redirect-only"}
  <div class="end-wrapper" aria-busy="true"></div>
{:else}
  <div class="end-wrapper">
    <div class="end-card">
      {#if gridLayout}
        <LayoutGrid layout={gridLayout} elements={$runner.elements} />
      {/if}

      {#if !$runner.elements.length}
        <h1>Experiment Complete</h1>
        <p>{config.message ?? "Thank you for participating."}</p>
      {/if}

      <div class="end-actions">
        <button class="btn-primary" onclick={complete} disabled={submitting}>
          {redirects ? "Continue →" : "Finish"}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .end-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 1rem;
  }
  .end-card {
    text-align: center;
    max-width: 500px;
    width: 100%;
    padding: 2rem;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-sm);
  }
  .end-card h1 { font-size: 24px; font-weight: 700; margin: 0 0 1rem; }
  .end-card p { font-size: 14px; color: var(--gray-500); margin: 0.5rem 0; }
  .end-actions { margin-top: 2rem; }
  .btn-primary {
    background: var(--black);
    color: #fff;
    padding: 0.75rem 2rem;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 14px;
    cursor: pointer;
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
