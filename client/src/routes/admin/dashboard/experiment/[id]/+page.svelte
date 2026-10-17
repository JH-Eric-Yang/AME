<script lang="ts">
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import * as api from "$lib/api";
  import { experiment } from "$lib/stores/experiment";
  import { openBlockRequest } from "$lib/stores/adminNav";
  import { progressDirty } from "$lib/stores/progressDirty";
  import CanvasBuilder from "$lib/components/admin/canvas/CanvasBuilder.svelte";
  import SettingsTab from "$lib/components/admin/SettingsTab.svelte";
  import ProgressTab from "$lib/components/admin/progress/ProgressTab.svelte";
  import MediaTab from "$lib/components/admin/MediaTab.svelte";
  import ParticipantsTab from "$lib/components/admin/ParticipantsTab.svelte";
  import ResultsTab from "$lib/components/admin/ResultsTab.svelte";
  import MatchingTab from "$lib/components/admin/MatchingTab.svelte";
  import SessionDesignerTab from "$lib/components/admin/session/SessionDesignerTab.svelte";
  import ErrorsTab from "$lib/components/admin/errors/ErrorsTab.svelte";
  import ParticipantLinkBar from "$lib/components/admin/ParticipantLinkBar.svelte";

  type Tab =
    | "settings"
    | "builder"
    | "session"
    | "progress"
    | "media"
    | "participants"
    | "results"
    | "matching"
    | "errors";

  /** Matches the Errors tab's own refresh cadence, so the badge doesn't go stale while another tab is open. */
  const ErrorCountRefreshMs = 30_000;

  let tab: Tab = $state("builder");
  let loading = $state(true);
  let error = $state("");
  let saving = $state(false);
  let openErrorCount = $state(0);

  const experimentId = $derived($page.params.id!);

  /**
   * Bumped on every call so a slower, superseded poll can never overwrite the
   * count from a call started after it (e.g. the onaction refresh fired by a
   * resolve/reopen, racing an already-in-flight 30s poll) — same shape as the
   * generation guard in ErrorGroupList.svelte / webrtc/callSession.ts.
   */
  let openErrorCountGeneration = 0;

  async function loadOpenErrorCount() {
    const mine = ++openErrorCountGeneration;
    try {
      const count = (await api.listExperimentErrors(experimentId, "open")).length;
      if (mine !== openErrorCountGeneration) return;
      openErrorCount = count;
    } catch {
      // The badge is a convenience; the Errors tab itself surfaces load failures.
    }
  }

  // The Builder's "Open" action on a design-owned routine lands here. The
  // Session tab consumes and clears the request once it has mounted. It can
  // only fire from the Builder, so it never races the Progress tab's guard.
  $effect(() => {
    if ($openBlockRequest !== null) tab = "session";
  });

  /**
   * Leaving the Progress tab unmounts it and its local sequence goes with it,
   * so unsaved edits need confirming first. Every tab-bar button routes here.
   */
  function switchTab(next: Tab) {
    if (
      tab === "progress" &&
      $progressDirty &&
      !confirm("You have unsaved sequence changes. Leave the Progress tab and discard them?")
    ) {
      return;
    }
    tab = next;
  }

  onMount(async () => {
    try {
      const data = await api.getExperiment(experimentId);
      experiment.load(data);
    } catch (e) {
      error = e instanceof api.ApiError ? e.message : "Failed to load experiment";
    } finally {
      loading = false;
    }
  });

  // Separate from the async onMount above: an async callback's returned
  // Promise is not recognised by Svelte as a cleanup function, so the
  // interval needs its own synchronous onMount to be cleared on destroy.
  onMount(() => {
    void loadOpenErrorCount();
    const timer = setInterval(() => void loadOpenErrorCount(), ErrorCountRefreshMs);
    return () => clearInterval(timer);
  });

  async function handleSave() {
    saving = true;
    try {
      await api.updateExperiment(experimentId, {
        name: $experiment.name,
        description: $experiment.description,
        visible: $experiment.visible,
        allowNew: $experiment.allowNew,
        avCollection: $experiment.avCollection,
        bodyDetection: $experiment.bodyDetection,
        videoChat: $experiment.videoChat,
        supplementaryDevice: $experiment.supplementaryDevice,
        activeTime: $experiment.activeTime,
        rollBackTime: $experiment.rollBackTime,
        participantsPerSession: $experiment.participantsPerSession,
        participantIdParam: $experiment.participantIdParam,
        conditions: $experiment.conditions,
        randomization: $experiment.randomization,
        randomizationConfig: $experiment.randomizationConfig,
        matchingStrategy: $experiment.matchingStrategy,
        initialProperties: $experiment.initialProperties,
        conditionProperties: $experiment.conditionProperties,
        routines: $experiment.routines,
        sessionDesigns: $experiment.sessionDesigns,
      });
      experiment.markSaved();
    } catch (e) {
      error = e instanceof api.ApiError ? e.message : "Failed to save";
    } finally {
      saving = false;
    }
  }
</script>

{#if loading}
  <p class="muted">Loading...</p>
{:else if error}
  <p class="error">{error}</p>
{:else}
  <div class="experiment-page">
    <div class="page-header">
      <a href="/admin/dashboard" class="back">← Dashboard</a>
      <h1>{$experiment.name}</h1>
      {#if $experiment.dirty}
        <button class="btn-save" disabled={saving} onclick={handleSave}>
          {saving ? "Saving..." : "Save Changes"}
        </button>
      {/if}
    </div>
    <ParticipantLinkBar />

    <div class="tabs">
      <button class:active={tab === "settings"} onclick={() => switchTab("settings")}>Settings</button>
      <button class:active={tab === "builder"} onclick={() => switchTab("builder")}>Builder</button>
      <button class:active={tab === "session"} onclick={() => switchTab("session")}>Session</button>
      <button class:active={tab === "progress"} onclick={() => switchTab("progress")}>Progress</button>
      <button class:active={tab === "media"} onclick={() => switchTab("media")}>Media</button>
      <button class:active={tab === "participants"} onclick={() => switchTab("participants")}>Participants</button>
      <button class:active={tab === "results"} onclick={() => switchTab("results")}>Results</button>
      <button class:active={tab === "matching"} onclick={() => switchTab("matching")}>Matching</button>
      <button class:active={tab === "errors"} onclick={() => switchTab("errors")}>Errors{openErrorCount > 0 ? ` (${openErrorCount})` : ""}</button>
    </div>

    <div class="tab-content">
      {#if tab === "settings"}
        <SettingsTab />
      {:else if tab === "builder"}
        <CanvasBuilder />
      {:else if tab === "session"}
        <SessionDesignerTab {experimentId} onviewcontent={() => (tab = "progress")} />
      {:else if tab === "progress"}
        <ProgressTab {experimentId} />
      {:else if tab === "media"}
        <MediaTab {experimentId} />
      {:else if tab === "participants"}
        <ParticipantsTab {experimentId} />
      {:else if tab === "results"}
        <ResultsTab {experimentId} />
      {:else if tab === "matching"}
        <MatchingTab {experimentId} />
      {:else if tab === "errors"}
        <ErrorsTab {experimentId} onaction={loadOpenErrorCount} />
      {/if}
    </div>
  </div>
{/if}

<style>
  .page-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .back {
    font-size: 14px;
    color: var(--gray-500);
    text-decoration: none;
  }
  .back:hover { color: var(--black); }

  h1 {
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin: 0;
    flex: 1;
  }

  .btn-save {
    background: var(--accent);
    color: #fff;
    padding: 0.5rem 1.1rem;
    border: none;
    border-radius: var(--radius);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .btn-save:disabled { opacity: 0.5; }

  .tabs {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 1rem;
  }

  .tabs button {
    position: relative;
    padding: 0.5rem 0.75rem;
    border: none;
    background: none;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    color: var(--gray-500);
  }
  .tabs button:hover { color: var(--black); }
  .tabs button.active { color: var(--black); font-weight: 600; }
  .tabs button.active::after {
    content: "";
    position: absolute;
    left: 50%;
    bottom: 0;
    width: 5px;
    height: 5px;
    margin-left: -2.5px;
    border-radius: 50%;
    background: var(--accent);
  }

  .tab-content {
    background: #fff;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-lg);
    min-height: 500px;
  }

  .muted { color: var(--gray-400); }
  .error { color: var(--danger); }
</style>
