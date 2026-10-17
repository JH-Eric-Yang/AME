<script lang="ts">
  import type { ElementConfig, VideoChatParams } from "ame-shared";
  import { transcriptKey } from "ame-shared/videoChat";
  import { runner } from "$lib/stores/runner";
  import { addressingContext, resolveTile } from "$lib/webrtc/callPlan";
  import VideoTile from "$lib/components/video/VideoTile.svelte";
  import TileRecorder from "$lib/components/video/TileRecorder.svelte";
  import ChatPanel from "$lib/components/video/ChatPanel.svelte";

  /**
   * One tile of the session call (spec §6.1). Media and connections belong to
   * callSession, driven by CallSessionHost from every tile on screen; this
   * component only resolves who it shows and renders it.
   */
  let { element }: { element: ElementConfig } = $props();

  const params = $derived(element.params as VideoChatParams);
  const tile = $derived(resolveTile(element.name, params, addressingContext($runner)));
  // A new delivery (progress, trial, or a re-delivery after reconnect) or a new
  // partner starts a new recording.
  const recordingKey = $derived(`${$runner.progress}:${$runner.trial}:${$runner.routineStartTime}:${tile.participantId}`);
</script>

<div class="el-video-chat">
  {#if tile.media.length > 0}
    <div class="media">
      <VideoTile {tile} />
    </div>
  {/if}
  {#if tile.record && tile.participantId}
    {#key recordingKey}
      <TileRecorder {tile} />
    {/key}
  {/if}
  {#if tile.text}
    <ChatPanel responseKey={transcriptKey(element.name, params)} />
  {/if}
</div>

<style>
  .el-video-chat { display: flex; flex-direction: column; gap: 0.5rem; width: 100%; height: 100%; }
  .media { flex: 1; aspect-ratio: 4 / 3; max-width: 100%; }
</style>
