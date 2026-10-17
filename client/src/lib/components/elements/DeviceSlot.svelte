<script lang="ts">
  import type { DeviceSource } from "ame-shared";

  let {
    source,
    status,
    stream,
  }: {
    source: DeviceSource;
    status: "waiting" | "connected" | "recording" | "disconnected";
    stream: MediaStream | null;
  } = $props();

  // State, so the effect runs again when the video appears after the stream.
  let videoEl = $state<HTMLVideoElement>();

  $effect(() => {
    if (videoEl && stream) {
      videoEl.srcObject = stream;
    }
  });

  const hasCamera = $derived(source.capabilities.includes("camera"));
  const hasMic = $derived(source.capabilities.includes("microphone") && !hasCamera);
  const icon = $derived(hasMic ? "🎤" : "📷");

  const statusText: Record<string, string> = {
    waiting: "Waiting for device...",
    connected: "Connected",
    recording: "Recording",
    disconnected: "Disconnected",
  };

  const statusColor: Record<string, string> = {
    waiting: "var(--gray-400)",
    connected: "var(--success)",
    recording: "var(--danger)",
    disconnected: "var(--accent)",
  };
</script>

<div class="device-slot" class:waiting={status === "waiting"} class:disconnected={status === "disconnected"}>
  {#if hasCamera && stream}
    <div class="preview">
      <video bind:this={videoEl} autoplay muted playsinline></video>
      <span class="label">{source.label}</span>
    </div>
  {:else if hasMic && status !== "waiting"}
    <div class="audio-indicator">
      <span class="icon">{icon}</span>
      <span class="name">{source.label}</span>
    </div>
  {:else}
    <div class="empty-slot">
      <span class="icon">{icon}</span>
    </div>
  {/if}

  <div class="slot-footer">
    <span class="slot-name">{source.label}</span>
    <span class="slot-status" style="color: {statusColor[status]}">{statusText[status]}</span>
  </div>
</div>

<style>
  .device-slot {
    border: 1px solid var(--gray-700);
    border-radius: 6px;
    overflow: hidden;
  }
  .device-slot.waiting { border-style: dashed; border-color: var(--gray-500); }
  .device-slot.disconnected { border-color: var(--accent); }
  .preview { position: relative; aspect-ratio: 4/3; background: var(--black); }
  .preview video { width: 100%; height: 100%; object-fit: cover; }
  .preview .label {
    position: absolute;
    top: 4px;
    left: 6px;
    font-size: 10px;
    color: var(--success);
    background: rgba(0,0,0,0.6);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
  }
  .audio-indicator {
    aspect-ratio: 4/3;
    background: var(--black);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }
  .audio-indicator .icon { font-size: 24px; }
  .audio-indicator .name { font-size: 11px; color: var(--gray-400); }
  .empty-slot {
    aspect-ratio: 4/3;
    background: var(--black);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .empty-slot .icon { font-size: 24px; opacity: 0.3; }
  .slot-footer {
    padding: 0.5rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .slot-name { font-size: 12px; font-weight: 500; }
  .slot-status { font-size: 10px; }
</style>
