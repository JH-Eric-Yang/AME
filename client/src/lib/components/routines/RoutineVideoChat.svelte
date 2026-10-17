<script lang="ts">
  import { onMount } from "svelte";
  import type { RoutineVideoChatConfig } from "ame-shared";
  import { runner } from "$lib/stores/runner";
  import * as socket from "$lib/socket/experimentSocket";
  import { callSession } from "$lib/webrtc/callSession";
  import { autoTiles } from "$lib/webrtc/callPlan";
  import { desiredPeers } from "$lib/webrtc/peerSelection";
  import { arrangeTiles, callStatus, CallStatusText, cardTitle, tileLabel } from "$lib/webrtc/callPanel";
  import { resolveVideoLayout } from "ame-shared/videoChat";
  import { resolvePartnerNotice, isReleasedFromMatching } from "$lib/webrtc/partnerAvailability";
  import { shouldEmitMatchJoin } from "$lib/matching/shouldJoinMatching";
  import LayoutGrid from "./LayoutGrid.svelte";
  import VideoTile from "$lib/components/video/VideoTile.svelte";
  import TileRecorder from "$lib/components/video/TileRecorder.svelte";

  const gridLayout = $derived($runner.routine?.layout ?? null);
  const config = $derived(($runner.routine?.config ?? {}) as RoutineVideoChatConfig);
  const elementPos = $derived(config.elementPosition ?? "left");
  // Custom: the researcher's video-chat elements are the whole call; no panel.
  const custom = $derived(resolveVideoLayout(config) === "custom");

  let matchJoinEmitted = false;

  // Truthiness, not `!== null`: RoutineEndMatching clears a finished session
  // with an EMPTY sessionId. A matching timeout releases the participant
  // without a session, so it is carried separately. A reloaded participant has
  // no sessionId but does have the session's members.
  const matched = $derived(
    isReleasedFromMatching({
      sessionId: $runner.sessionId,
      matchingTimedOut: $runner.matchingTimedOut,
      memberCount: $runner.sessionMembers.length,
    }),
  );

  // The peers the server assigned for this rotation — an interaction group
  // always wins, and an empty one means "sit this rotation out".
  const assignedPeers = $derived(desiredPeers($runner.interactionGroup, $runner.peers, $runner.participantId));

  // The same tiles CallSessionHost plans from (callPlan.tilesFor), so what is
  // rendered and what is dialled cannot disagree. Only the labels are added here.
  const tiles = $derived(
    autoTiles({ selfId: $runner.participantId, peers: assignedPeers, recordLocal: config.recordLocal === true }),
  );
  const selfTile = $derived({ ...tiles[0], label: "You" });
  const remoteTiles = $derived(
    tiles.slice(1).map((tile) => ({
      ...tile,
      label: tileLabel(tile.participantId ?? "", {
        peerCount: tiles.length - 1,
        memberRoles: $runner.memberRoles,
        members: $runner.sessionMembers,
      }),
    })),
  );
  const arrangement = $derived(arrangeTiles(remoteTiles.length));
  const showSelf = $derived(config.showLocalVideo !== false);

  const connectedPeers = $derived(
    [...$callSession.remoteStreams.keys()].filter((id) => id !== $runner.participantId),
  );
  const status = $derived(callStatus(matched, assignedPeers, connectedPeers));
  const peopleCount = $derived(remoteTiles.length + 1);
  const title = $derived(cardTitle(config.cardTitle, $runner.roleName));
  const partnerNotice = $derived(
    resolvePartnerNotice({
      matched,
      partnerUnavailable: $runner.interactionGroup?.partnerUnavailable ?? false,
      desiredPeers: assignedPeers,
      connectedPeers,
      partnerDropped: $runner.partnerDropped,
      customText: config.partnerUnavailableText,
    }),
  );

  // A new delivery starts a new local recording.
  const recordingKey = $derived(`${$runner.progress}:${$runner.trial}:${$runner.routineStartTime}`);

  onMount(() => {
    // Only a routine that carries its own matching config may join. A compiled
    // trial routine (matching: null) rides on the session formed by the
    // preceding routine-matching; joining again would close it.
    const { routine, sessionId } = $runner;
    if (routine && shouldEmitMatchJoin(routine, sessionId, matchJoinEmitted)) {
      socket.emitMatchJoin(routine.name);
      matchJoinEmitted = true;
    }
  });
</script>

{#snippet controls(variant: "bar" | "pills")}
  <div class="controls {variant}">
    <button type="button" class="ctrl-btn" class:active={$callSession.audioMuted} onclick={() => callSession.toggleAudio()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></svg>
      {$callSession.audioMuted ? "Unmute" : "Mute"}
    </button>
    <button type="button" class="ctrl-btn" class:active={$callSession.videoOff} onclick={() => callSession.toggleVideo()}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" /></svg>
      {$callSession.videoOff ? "Camera On" : "Camera Off"}
    </button>
  </div>
{/snippet}

{#if custom}
<div class="video-chat-custom">
  {#if !matched}
    <div class="custom-notice" role="status">
      Waiting for the others...
      {#if $runner.matchingStatus}({$runner.matchingStatus.current} of {$runner.matchingStatus.target} ready){/if}
    </div>
  {:else if $callSession.mediaBlocked}
    <div class="custom-notice" role="status">
      We could not access your camera or microphone. Check your browser's
      permissions for this page and reload.
    </div>
  {:else if partnerNotice}
    <div class="custom-notice" role="status">{partnerNotice}</div>
  {/if}
  <div class="custom-elements">
    {#if gridLayout}
      <LayoutGrid layout={gridLayout} elements={$runner.elements} />
    {/if}
  </div>
  {@render controls("bar")}
</div>
{:else}
<div class="video-chat-layout" class:top={elementPos === "top"} class:bottom={elementPos === "bottom"}>
  <section class="task-card" aria-label={title || "Task"}>
    {#if title}
      <div class="card-head"><span class="card-title">{title}</span></div>
    {/if}
    <div class="card-body">
      {#if gridLayout}
        <LayoutGrid layout={gridLayout} elements={$runner.elements} />
      {/if}
    </div>
  </section>

  <section class="call-panel" aria-label="Video call">
    <div class="call-head">
      <span class="call-status {status}" role="status">{CallStatusText[status]}</span>
      <span>{peopleCount} {peopleCount === 1 ? "person" : "people"}</span>
    </div>

    <div class="tiles" class:grid={arrangement.columns === 2} class:stacked={arrangement.columns === 1 && remoteTiles.length === 2}>
      {#each remoteTiles as tile (tile.name)}
        <div class="tile-frame">
          <!-- The panel-wide notices cover waiting and unavailable; a tile still
               negotiating shows its own "Connecting…" so it is not a bare black box. -->
          <VideoTile {tile} notices="connecting" />
        </div>
      {/each}

      {#if remoteTiles.length === 0}
        <div class="tile-frame placeholder">Partner</div>
      {/if}

      {#if showSelf}
        <div class="tile-frame self" class:inset={arrangement.selfInset}>
          <VideoTile tile={selfTile} notices="none" />
        </div>
      {/if}

      {#if !matched}
        <div class="call-overlay">
          <p>Waiting for the others...</p>
          {#if $runner.matchingStatus}
            <p class="muted">{$runner.matchingStatus.current} of {$runner.matchingStatus.target} ready</p>
          {/if}
        </div>
      {:else if $callSession.mediaBlocked}
        <div class="call-notice">
          We could not access your camera or microphone. Check your browser's
          permissions for this page and reload.
        </div>
      {:else if partnerNotice}
        <div class="call-notice">{partnerNotice}</div>
      {/if}
    </div>

    {#if selfTile.record}
      {#key recordingKey}
        <TileRecorder tile={selfTile} />
      {/key}
    {/if}

    {@render controls("pills")}
  </section>
</div>
{/if}

<style>
  /* ── Custom layout ─────────────────────────────── */
  .video-chat-custom {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
  .custom-elements {
    flex: 1;
    padding: 0.5rem;
    overflow-y: auto;
  }
  .custom-notice {
    padding: 0.6rem 1rem;
    color: var(--white);
    background: var(--black);
    font-size: 13px;
    text-align: center;
  }

  /* ── Automatic panel: one screen, no page scroll ── */
  .video-chat-layout {
    box-sizing: border-box;
    height: 100vh;
    height: 100dvh;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
    gap: 1rem;
    padding: 1rem;
    background: var(--gray-100);
    overflow: hidden;
  }
  .video-chat-layout.top,
  .video-chat-layout.bottom {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) minmax(0, 1.2fr);
  }
  .video-chat-layout.bottom .task-card { order: 2; }

  .task-card {
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--white);
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .card-head {
    padding: 0.7rem 1.1rem;
    border-bottom: 1px solid var(--gray-200);
  }
  .card-title {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .card-title::before {
    content: "";
    width: 9px;
    height: 9px;
    background: var(--black);
  }
  /* Only the card scrolls, and only when the task is taller than the window. */
  .card-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    justify-content: safe center;
  }

  .call-panel {
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: 0.6rem;
    padding: 0.7rem;
    background: var(--black);
    border: 1px solid var(--gray-700);
    border-radius: var(--radius-lg);
  }
  .call-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 0.25rem;
    color: var(--gray-400);
    font-family: var(--font-display);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .call-status {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--white);
  }
  .call-status::before {
    content: "";
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--gray-500);
  }
  .call-status.connected::before {
    background: var(--success);
    box-shadow: 0 0 0 3px var(--success-dim);
  }

  /* 1 other: one large video. 2: stacked. 3+: a two-column grid. */
  .tiles {
    position: relative;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-auto-rows: minmax(0, 1fr);
    gap: 0.5rem;
  }
  .tiles.grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .tile-frame {
    min-height: 0;
    border: 1px solid var(--gray-700);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .tile-frame :global(.tile) { min-height: 0; }
  .tile-frame.placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--gray-500);
    font-size: 14px;
  }
  .tile-frame.self { border: 2px solid var(--white); }
  .tile-frame.self.inset {
    position: absolute;
    top: 0.7rem;
    right: 0.7rem;
    width: 26%;
    min-width: 120px;
    aspect-ratio: 4 / 3;
    z-index: 1;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
  }
  .tiles.stacked .tile-frame.self.inset { width: 20%; }

  .call-overlay,
  .call-notice {
    position: absolute;
    z-index: 2;
    color: var(--white);
    text-align: center;
  }
  .call-overlay {
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(10, 10, 10, 0.75);
    border-radius: var(--radius);
  }
  .call-overlay p { margin: 0.2rem 0; }
  .call-overlay .muted { color: var(--gray-400); font-size: 13px; }
  .call-notice {
    left: 0.5rem;
    right: 0.5rem;
    bottom: 0.5rem;
    padding: 0.55rem 0.9rem;
    background: rgba(10, 10, 10, 0.85);
    border-radius: var(--radius-sm);
    font-size: 13px;
  }

  /* ── Controls ── */
  .controls {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
  }
  .controls.bar {
    padding: 0.5rem;
    background: var(--black);
  }
  .ctrl-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    font: inherit;
    font-size: 13px;
    color: var(--white);
    background: var(--gray-700);
    border: 1px solid var(--gray-600);
    padding: 0.4rem 1rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .controls.pills .ctrl-btn { border-radius: var(--radius-pill); }
  .ctrl-btn svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
  }
  .ctrl-btn:focus-visible { outline: 2px solid var(--white); outline-offset: 2px; }
  .ctrl-btn.active {
    background: var(--danger);
    border-color: var(--danger);
  }

  /* A phone: stack the two parts and let the page scroll again. */
  @media (max-width: 700px) {
    .video-chat-layout,
    .video-chat-layout.top,
    .video-chat-layout.bottom {
      height: auto;
      min-height: 100dvh;
      overflow: visible;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto;
    }
    .call-panel { height: 70vh; }
  }
</style>
