<script lang="ts">
  import Logo from "$lib/components/Logo.svelte";
  import { page } from "$app/stores";
  import { onMount, onDestroy } from "svelte";
  import { runner, runnerState } from "$lib/stores/runner";
  import * as socket from "$lib/socket/experimentSocket";
  import RoutineRenderer from "$lib/components/routines/RoutineRenderer.svelte";
  import { installErrorReporting } from "$lib/errors/reporter";

  const experimentId = $derived($page.params.expId!);
  const joined = $derived($runner.participantId !== "");
  let started = $state(false);
  let uninstallErrorReporting: (() => void) | null = null;

  onMount(() => {
    runner.reset();
    runner.setExperimentId(experimentId);
    socket.connect(experimentId);
    uninstallErrorReporting = installErrorReporting();
  });

  onDestroy(() => {
    uninstallErrorReporting?.();
    socket.disconnect();
  });

  function handleStart() {
    const savedResponseId = localStorage.getItem(`ame-responseId-${experimentId}`) ?? undefined;

    // Capture the recruitment platform's participant id when the experiment
    // names one (e.g. ?PROLIFIC_PID=... with participantIdParam "PROLIFIC_PID").
    const param = $runner.config?.participantIdParam;
    const externalId = param
      ? ($page.url.searchParams.get(param) ?? undefined)
      : undefined;

    socket.joinExperiment(savedResponseId, externalId);
    started = true;
  }

  function handleReady() {
    socket.emitReady();
  }
</script>

<div class="runner">
  {#if $runner.error && $runnerState !== "WITHDRAWN"}
    <div class="error-bar">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.2"/><path d="M7 4v3M7 9v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      <span>{$runner.error}</span>
    </div>
  {/if}

  {#if $runnerState === "INIT"}
    <div class="center-screen">
      <div class="init-state">
        <div class="pulse-ring"></div>
        <p>Connecting</p>
      </div>
    </div>

  {:else if $runnerState === "LOBBY" && !started}
    <div class="center-screen">
      <div class="lobby">
        <div class="lobby-badge"><Logo size={32} /></div>
        <h1>{$runner.config?.name ?? "Experiment"}</h1>
        <p class="lobby-desc">{$runner.config?.description ?? "Welcome to this experiment."}</p>
        <div class="lobby-divider"></div>
        <p class="lobby-hint">When you are ready, press the button below to begin.</p>
        <button class="start-btn" onclick={handleStart}>
          <span>Begin Experiment</span>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 7h12M8 2l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </div>

  {:else if $runnerState === "LOBBY" && started}
    <div class="center-screen">
      <div class="lobby">
        <div class="pulse-ring small"></div>
        <p class="lobby-loading">
          {joined ? "Joined successfully. Preparing your session..." : "Joining..."}
        </p>
        <!-- The server rejects exp:ready before the join completes, so keep
             the button disabled until the participant id has arrived. -->
        <button class="start-btn" onclick={handleReady} disabled={!joined}>
          <span>I'm Ready</span>
        </button>
      </div>
    </div>

  {:else if $runnerState === "MATCHING"}
    <div class="center-screen">
      <div class="matching">
        <div class="match-visual">
          <div class="orbit">
            <div class="orbit-dot"></div>
          </div>
          <div class="orbit delay">
            <div class="orbit-dot"></div>
          </div>
        </div>
        <!-- "Group", not "partner": a routine can seat more than two. -->
        <h2>Finding your group</h2>
        <p>Please wait while we match you with the other participants.</p>
        {#if $runner.matchingStatus}
          <div class="match-progress">
            <div class="match-bar">
              <div class="match-fill" style="width: {($runner.matchingStatus.current / $runner.matchingStatus.target) * 100}%"></div>
            </div>
            <span class="match-count">{$runner.matchingStatus.current} / {$runner.matchingStatus.target}</span>
          </div>
        {/if}
      </div>
    </div>

  {:else if $runnerState === "RUNNING" && $runner.routine}
    <RoutineRenderer />

  {:else if $runnerState === "COMPLETED"}
    <div class="center-screen">
      <div class="lobby">
        <div class="complete-icon">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="18" stroke="var(--black)" stroke-width="1.5"/>
            <path d="M12 20l5 5 11-11" stroke="var(--black)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <h1>Thank You</h1>
        <p class="lobby-desc">You have completed the experiment. Your responses have been recorded.</p>
      </div>
    </div>

  {:else if $runnerState === "WITHDRAWN"}
    <div class="center-screen">
      <div class="lobby">
        <h1>Session Ended</h1>
        <p class="lobby-desc">{$runner.error ?? "You have been withdrawn from the experiment."}</p>
      </div>
    </div>
  {/if}
</div>

<style>
  .runner {
    min-height: 100vh;
    background: var(--white);
    position: relative;
  }

  .center-screen {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 2rem;
  }

  .error-bar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.6rem;
    background: var(--accent-dim);
    border-bottom: 1px solid var(--accent);
    color: var(--accent);
    font-size: 13px;
    z-index: 50;
  }

  /* Init state */
  .init-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }
  .init-state p {
    font-family: var(--font-display);
    font-size: 12px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--gray-400);
  }

  .pulse-ring {
    /* A fixed-size block ignores the parent's text-align, so without this the
       ring hugs the left edge of a centred column while the text under it
       looks centred. */
    margin: 0 auto;
    width: 48px;
    height: 48px;
    border: 2px solid var(--gray-200);
    border-top-color: var(--black);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  .pulse-ring.small {
    width: 32px;
    height: 32px;
    margin: 0 auto 0.5rem;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Lobby */
  .lobby {
    text-align: center;
    max-width: 480px;
  }

  .lobby-badge { display: flex; justify-content: center; margin-bottom: 1.25rem; }

  .lobby h1 {
    font-family: var(--font-body);
    font-size: 30px;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin: 0 0 0.75rem;
  }

  .lobby-desc {
    font-size: 15px;
    line-height: 1.7;
    color: var(--gray-500);
    margin: 0;
  }

  .lobby-divider {
    width: 40px;
    height: 1px;
    background: var(--gray-200);
    margin: 1.5rem auto;
  }

  .lobby-hint {
    font-size: 13px;
    color: var(--gray-400);
    margin: 0 0 1.5rem;
  }

  .lobby-loading {
    font-size: 14px;
    color: var(--gray-500);
    margin: 0 0 1.5rem;
  }

  .start-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.85rem 2rem;
    background: var(--black);
    color: var(--white);
    border: none;
    border-radius: var(--radius);
    font-family: var(--font-body);
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: background var(--transition), transform var(--transition);
  }
  .start-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .start-btn:hover {
    background: var(--accent);
    transform: translateY(-1px);
  }
  .start-btn svg { transition: transform var(--transition); }
  .start-btn:hover svg { transform: translateX(3px); }

  /* Matching */
  .matching {
    text-align: center;
    max-width: 400px;
  }

  .match-visual {
    position: relative;
    width: 80px;
    height: 80px;
    margin: 0 auto 1.5rem;
  }

  .orbit {
    position: absolute;
    inset: 0;
    border: 1px solid var(--gray-200);
    border-radius: 50%;
    animation: orbit-spin 3s linear infinite;
  }
  .orbit.delay {
    inset: 10px;
    animation-duration: 2s;
    animation-direction: reverse;
    border-color: var(--gray-300);
  }

  .orbit-dot {
    position: absolute;
    top: -3px;
    left: 50%;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--black);
    transform: translateX(-50%);
  }
  .orbit.delay .orbit-dot { background: var(--accent); }

  @keyframes orbit-spin { to { transform: rotate(360deg); } }

  .matching h2 {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.01em;
    margin: 0 0 0.5rem;
  }
  .matching p {
    font-size: 13px;
    color: var(--gray-500);
    margin: 0;
  }

  .match-progress {
    margin-top: 1.5rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .match-bar {
    flex: 1;
    height: 4px;
    background: var(--gray-100);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .match-fill {
    height: 100%;
    background: var(--accent);
    border-radius: var(--radius-sm);
    transition: width 0.5s ease;
  }
  .match-count {
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 500;
    color: var(--gray-500);
    white-space: nowrap;
  }

  /* Completed */
  .complete-icon {
    margin-bottom: 1rem;
  }
</style>
