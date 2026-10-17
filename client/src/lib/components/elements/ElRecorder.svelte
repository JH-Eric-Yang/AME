<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { ElementConfig, RecorderParams } from "ame-shared";
  import { runner } from "$lib/stores/runner";
  import { RecordingManager, type RecordingConfig } from "$lib/recording/RecordingManager";
  import { reportClientError } from "$lib/errors/reporter";

  let { element }: { element: ElementConfig } = $props();
  const p = $derived(element.params as RecorderParams);

  let videoEl: HTMLVideoElement;
  let stream: MediaStream | null = $state(null);
  let manager: RecordingManager | null = $state(null);
  let recording = $state(false);

  // Upload state
  let uploadStatus: "idle" | "uploading" | "complete" | "failed" = $state("idle");
  let uploadProgress = $state(0);

  // Auto-stop when proceed is requested
  $effect(() => {
    if ($runner.proceedRequested && recording) {
      manager?.stop();
    }
  });

  let destroyed = false;

  onMount(async () => {
    const constraints: MediaStreamConstraints = {};
    if (p.mode === "audio") {
      constraints.audio = true;
    } else if (p.mode === "screen") {
      // handled separately
    } else {
      constraints.video = p.constraints ?? true;
      constraints.audio = true;
    }

    try {
      const media =
        p.mode === "screen"
          ? await navigator.mediaDevices.getDisplayMedia({ video: true })
          : await navigator.mediaDevices.getUserMedia(constraints);

      // The routine can end while the permission prompt is still open; without
      // this the tracks are never stopped and the camera stays on.
      if (destroyed) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = media;

      if (videoEl && p.showPreview !== false && p.mode !== "audio") {
        videoEl.srcObject = stream;
      }
      if (p.autoStart) startRecording();
    } catch (err) {
      // permission denied
      reportClientError(err, { kind: p.mode === "screen" ? "getDisplayMedia" : "getUserMedia", element: element.name });
    }
  });

  onDestroy(() => {
    destroyed = true;
    manager?.dispose();
    stream?.getTracks().forEach((t) => t.stop());
  });

  function startRecording() {
    if (!stream) return;

    const config: RecordingConfig = {
      uploadMode: p.uploadMode ?? "on-stop",
      experimentId: $runner.experimentId,
      participantId: $runner.participantId,
      progress: $runner.progress,
      trial: $runner.trial,
      elementName: element.name,
      maxDuration: p.maxDuration ?? undefined,
    };

    manager = new RecordingManager(stream, config);

    // Wire callbacks to Svelte state
    manager.onStateChange = (state) => {
      recording = state.recording;
      uploadStatus = state.uploadStatus;
      uploadProgress = state.uploadProgress;
    };
    manager.onUploadComplete = () => {
      // Response first: "complete" releases a waiting proceed, which sends the responses at once.
      runner.setResponse(element.name, manager!.getResponse());
      runner.updateUpload(element.name, { status: "complete", progress: 100 });
    };
    manager.onUploadFailed = () => {
      runner.updateUpload(element.name, { status: "failed" });
    };

    runner.registerUpload(element.name);
    runner.updateUpload(element.name, { status: "uploading" });
    manager.start();
  }

  function stopRecording() {
    manager?.stop();
  }

  function retryUpload() {
    manager?.retry();
  }

  function handleSaveToDevice() {
    manager?.saveToDevice();
  }
</script>

<div class="el-recorder">
  {#if p.showPreview !== false && p.mode !== "audio"}
    <div class="preview">
      <video bind:this={videoEl} autoplay muted playsinline></video>
    </div>
  {/if}

  {#if !p.autoStart && uploadStatus === "idle" && !recording}
    <div class="controls">
      <button class="btn-rec" onclick={startRecording}>Start Recording</button>
    </div>
  {/if}

  {#if recording}
    <div class="controls">
      {#if p.showStopButton !== false}
        <button class="btn-stop" onclick={stopRecording}>Stop Recording</button>
      {/if}
      <span class="rec-indicator">
        <span class="rec-dot"></span> REC
      </span>
      {#if p.uploadMode === "streaming"}
        <span class="upload-info">{Math.round(uploadProgress / 1024)}KB sent</span>
      {/if}
    </div>
  {/if}

  {#if uploadStatus === "uploading" && !recording}
    <div class="upload-bar">
      <div class="upload-label">Uploading...</div>
      {#if p.uploadMode !== "streaming"}
        <div class="progress-track">
          <div class="progress-fill" style="width: {uploadProgress}%"></div>
        </div>
        <div class="upload-pct">{uploadProgress}%</div>
      {:else}
        <div class="upload-label">Finalizing...</div>
      {/if}
    </div>
  {/if}

  {#if uploadStatus === "complete"}
    <div class="upload-done">Upload complete</div>
  {/if}

  {#if uploadStatus === "failed"}
    <div class="upload-failed">
      <p>Upload failed.</p>
      <div class="retry-actions">
        <button class="btn-rec" onclick={retryUpload}>Retry</button>
        <button class="btn-save" onclick={handleSaveToDevice}>Save to device</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .el-recorder { text-align: center; }
  .preview {
    width: 100%;
    max-width: 320px;
    margin: 0 auto 0.5rem;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-sm);
    overflow: hidden;
    aspect-ratio: 4/3;
    background: var(--black);
  }
  video { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }
  .controls { display: flex; align-items: center; justify-content: center; gap: 0.5rem; }
  .btn-rec, .btn-save {
    background: var(--black);
    color: #fff;
    padding: 0.5rem 1.5rem;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 14px;
    cursor: pointer;
  }
  .btn-stop {
    background: var(--danger);
    color: #fff;
    padding: 0.5rem 1.5rem;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 14px;
    cursor: pointer;
  }
  .rec-indicator { color: var(--danger); font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 0.35rem; }
  .rec-dot {
    width: 10px;
    height: 10px;
    background: var(--danger);
    border-radius: 50%;
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
  .upload-info { color: var(--gray-500); font-size: 12px; }
  .upload-bar { margin-top: 0.5rem; }
  .upload-label { font-size: 13px; color: var(--gray-500); margin-bottom: 0.25rem; }
  .progress-track {
    height: 4px;
    background: var(--gray-200);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: var(--black);
    transition: width 0.2s;
  }
  .upload-pct { font-size: 12px; color: var(--gray-500); margin-top: 0.25rem; }
  .upload-done { font-size: 13px; color: var(--gray-700); margin-top: 0.5rem; }
  .upload-failed { margin-top: 0.5rem; }
  .upload-failed p { color: var(--danger); font-size: 13px; margin-bottom: 0.5rem; }
  .retry-actions { display: flex; gap: 0.5rem; justify-content: center; }
</style>
