<script lang="ts">
  import { runner } from "$lib/stores/runner";
  import { callSession } from "$lib/webrtc/callSession";
  import { tilePlayback, tileStatus, type ResolvedTile } from "$lib/webrtc/callPlan";
  import { DefaultPartnerUnavailableText, isReleasedFromMatching } from "$lib/webrtc/partnerAvailability";

  interface Props {
    tile: ResolvedTile;
    /**
     * Which notices the tile draws. RoutineVideoChat shows waiting and
     * unavailable panel-wide, so its tiles draw only "connecting" (or nothing).
     */
    notices?: "all" | "connecting" | "none";
    unavailableText?: string;
  }

  let { tile, notices = "all", unavailableText }: Props = $props();

  const ConnectingText = "Connecting…";
  const WaitingText = "Waiting for the others…";
  const BlockedText = "We could not access your camera or microphone. Check your browser's permissions for this page and reload.";

  // Primitives, so the subscription below is rebuilt only when the address
  // changes — not on every runner write that re-derives the tile object.
  const participantId = $derived(tile.participantId);
  const self = $derived(tile.self);
  const stream = $derived(callSession.streamFor(participantId, self));

  const playback = $derived(tilePlayback(tile));
  const matched = $derived(
    isReleasedFromMatching({
      sessionId: $runner.sessionId,
      matchingTimedOut: $runner.matchingTimedOut,
      memberCount: $runner.sessionMembers.length,
    }),
  );
  const status = $derived(
    tileStatus(tile, { matched, hasStream: $stream !== null, partnerDropped: $runner.partnerDropped }),
  );
  const notice = $derived.by(() => {
    if (self && $callSession.mediaBlocked) return BlockedText;
    if (status === "live") return null;
    if (status === "unavailable") return unavailableText?.trim() || DefaultPartnerUnavailableText;
    return status === "waiting" ? WaitingText : ConnectingText;
  });

  let videoEl = $state<HTMLVideoElement | null>(null);
  let audioEl = $state<HTMLAudioElement | null>(null);

  $effect(() => {
    const current = $stream;
    if (videoEl && videoEl.srcObject !== current) videoEl.srcObject = current;
    if (audioEl && audioEl.srcObject !== current) audioEl.srcObject = current;
  });
</script>

<div class="tile">
  {#if playback.showVideo}
    <!-- Muted unless this tile plays audio: a self tile never plays its own
         microphone, and a video-only tile hides the partner's audio. -->
    <video bind:this={videoEl} autoplay playsinline muted={!playback.playAudio} class:mirror={tile.mirror}></video>
  {:else}
    {#if playback.playAudio}
      <audio bind:this={audioEl} autoplay></audio>
    {/if}
    <div class="audio-only">{self ? "Microphone" : "Audio"}</div>
  {/if}

  {#if tile.label}
    <div class="label">{tile.label}</div>
  {/if}

  {#if notice && (notices === "all" || (notices === "connecting" && status === "connecting" && !self))}
    <div class="notice">{notice}</div>
  {/if}
</div>

<style>
  .tile {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 120px;
    background: var(--black);
    overflow: hidden;
  }
  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  video.mirror { transform: scaleX(-1); }
  .audio-only {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--gray-400);
    font-size: 13px;
  }
  .label {
    position: absolute;
    left: 0.5rem;
    bottom: 0.5rem;
    padding: 0.15rem 0.5rem;
    color: #fff;
    background: rgba(0, 0, 0, 0.6);
    border-radius: var(--radius-sm);
    font-size: 12px;
  }
  .notice {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    color: #fff;
    background: rgba(0, 0, 0, 0.7);
    font-size: 13px;
    text-align: center;
  }
</style>
