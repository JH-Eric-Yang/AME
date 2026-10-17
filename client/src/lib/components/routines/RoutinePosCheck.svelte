<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { runner } from "$lib/stores/runner";
  import * as socket from "$lib/socket/experimentSocket";
  import * as mediapipe from "$lib/detection/mediapipe-service";
  import { validateFov, type NormalizedLandmark } from "$lib/detection/fov-validator";
  import { renderGuides } from "$lib/detection/guide-renderer";
  import LayoutGrid from "./LayoutGrid.svelte";
  import ElementRenderer from "../elements/ElementRenderer.svelte";
  import type { RoutinePosCheckConfig } from "ame-shared";

  const DefaultRequiredDuration = 3000;
  const DefaultConfig: RoutinePosCheckConfig = { mode: "legacy" };

  const config = $derived(
    ($runner.routine?.config as RoutinePosCheckConfig | undefined) ?? DefaultConfig,
  );

  let videoEl: HTMLVideoElement;
  let canvasEl: HTMLCanvasElement;
  let stream: MediaStream | null = $state(null);
  let status = $state<"initializing" | "checking" | "holding" | "passed">("initializing");
  let guidance = $state<string | undefined>(undefined);
  let holdStartTime = $state<number | null>(null);
  let holdRemaining = $state<number>(0);
  let animFrameId: number | null = null;
  let latestLandmarks: NormalizedLandmark[] = [];

  const requiredDuration = $derived(config.requiredDuration ?? DefaultRequiredDuration);

  onMount(async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (videoEl) {
        videoEl.srcObject = stream;
        await videoEl.play();
      }
      await mediapipe.initialize();
      status = "checking";
      requestDetectionLoop();
    } catch {
      guidance = "Camera access denied. Please allow camera access and reload.";
    }
  });

  onDestroy(() => {
    if (animFrameId != null) cancelAnimationFrame(animFrameId);
    stream?.getTracks().forEach((t) => t.stop());
    mediapipe.destroy();
  });

  function requestDetectionLoop() {
    animFrameId = requestAnimationFrame(detectionLoop);
  }

  function detectionLoop() {
    if (status === "passed") return;

    if (videoEl && videoEl.readyState >= 2) {
      // Sync canvas size to video
      if (canvasEl) {
        canvasEl.width = videoEl.videoWidth;
        canvasEl.height = videoEl.videoHeight;
      }

      const detection = mediapipe.detect(videoEl);
      if (detection) {
        latestLandmarks = detection.landmarks;
        const result = validateFov(detection.landmarks, config);
        guidance = result.guidance;

        // Render guides on canvas
        if (canvasEl) {
          const ctx = canvasEl.getContext("2d");
          if (ctx) {
            renderGuides(ctx, result, config, detection.landmarks, {
              width: canvasEl.width,
              height: canvasEl.height,
            });
          }
        }

        // Handle hold timer
        if (result.passed) {
          if (holdStartTime == null) {
            holdStartTime = performance.now();
            status = "holding";
          }
          const elapsed = performance.now() - holdStartTime;
          holdRemaining = Math.max(0, requiredDuration - elapsed);
          if (elapsed >= requiredDuration) {
            status = "passed";
            return;
          }
        } else {
          // Reset hold if validation fails
          holdStartTime = null;
          holdRemaining = 0;
          status = "checking";
        }
      }
    }

    requestDetectionLoop();
  }

  function handleProceed() {
    socket.emitProceed();
  }
</script>

<div class="pos-check-wrapper">
  <div class="pos-check-card">
    <h2>Position Check</h2>

    <div class="video-container">
      <video bind:this={videoEl} autoplay muted playsinline></video>
      <canvas bind:this={canvasEl}></canvas>
    </div>

    <div class="status-area">
      {#if status === "initializing"}
        <p>Loading camera and detection model...</p>
      {:else if status === "checking"}
        <p>{guidance ?? "Adjust your position to match the guides."}</p>
      {:else if status === "holding"}
        <p class="holding">Hold still... {(holdRemaining / 1000).toFixed(1)}s</p>
      {:else if status === "passed"}
        <p class="success">Position verified.</p>
        <button class="btn-primary" onclick={handleProceed}>Continue</button>
      {/if}
    </div>

    {#if $runner.routine?.layout}
      <LayoutGrid layout={$runner.routine.layout} elements={$runner.elements} />
    {:else}
      {#each $runner.elements as element (`${$runner.progress}:${element.name}`)}
        <ElementRenderer {element} />
      {/each}
    {/if}
  </div>
</div>

<style>
  .pos-check-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 1rem;
  }
  .pos-check-card {
    text-align: center;
    max-width: 600px;
    width: 100%;
    padding: 2rem;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-sm);
  }
  .pos-check-card h2 {
    font-size: 18px;
    font-weight: 600;
    margin: 0 0 0.5rem;
  }
  .video-container {
    position: relative;
    width: 100%;
    max-width: 480px;
    margin: 1rem auto;
    border: 2px solid var(--gray-200);
    border-radius: var(--radius-sm);
    overflow: hidden;
    aspect-ratio: 4/3;
    background: var(--black);
  }
  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scaleX(-1);
  }
  canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    transform: scaleX(-1);
  }
  .status-area {
    min-height: 3rem;
    margin: 0.5rem 0;
  }
  .status-area p {
    color: var(--gray-500);
    font-size: 14px;
  }
  .holding {
    color: var(--accent) !important;
    font-weight: 600;
  }
  .success {
    color: var(--success) !important;
    font-weight: 600;
  }
  .btn-primary {
    background: var(--black);
    color: #fff;
    padding: 0.75rem 2rem;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 14px;
    cursor: pointer;
    margin-top: 1rem;
  }
</style>
