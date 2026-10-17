<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { ElementConfig, BodyDetectorParams } from "ame-shared";
  import { fireElementEvents } from "$lib/elements/fireEvents";
  import * as mediapipe from "$lib/detection/mediapipe-service";
  import { detectGesture } from "$lib/detection/gesture-detector";
  import { renderGuides } from "$lib/detection/guide-renderer";
  import { validateFov } from "$lib/detection/fov-validator";

  const DefaultDuration = 3000;
  const DefaultThreshold = 0.5;

  let { element }: { element: ElementConfig } = $props();
  const p = $derived(element.params as BodyDetectorParams);

  const gesture = $derived(p.gesture ?? "face-present");
  const duration = $derived(p.duration ?? DefaultDuration);
  const threshold = $derived(p.confidenceThreshold ?? DefaultThreshold);
  const showOverlay = $derived(p.showOverlay ?? false);

  let videoEl: HTMLVideoElement;
  let canvasEl: HTMLCanvasElement;
  let stream: MediaStream | null = $state(null);
  let animFrameId: number | null = null;
  let detected = $state(false);
  let holdStartTime: number | null = null;
  let holdRemaining = $state(0);
  let fired = $state(false);
  let error = $state<string | null>(null);

  // Does this gesture need the hand model?
  const needsHands = $derived(
    ["index-finger-up", "thumbs-up", "open-palm", "peace-sign", "fist"].includes(gesture),
  );

  let destroyed = false;
  let modelsInitialized = false;

  onMount(async () => {
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });

      // The routine can end while the permission prompt is still open; without
      // this the tracks are never stopped and the camera stays on.
      if (destroyed) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = media;

      if (videoEl) {
        videoEl.srcObject = stream;
        await videoEl.play();
      }

      await mediapipe.initialize();
      if (needsHands) {
        await mediapipe.initializeHands();
      }
      if (destroyed) {
        mediapipe.destroy();
        if (needsHands) mediapipe.destroyHands();
        return;
      }
      modelsInitialized = true;

      requestDetectionLoop();
    } catch (err) {
      error = `Camera error: ${err instanceof Error ? err.message : "unknown"}`;
    }
  });

  onDestroy(() => {
    destroyed = true;
    if (animFrameId != null) cancelAnimationFrame(animFrameId);
    stream?.getTracks().forEach((t) => t.stop());
    if (modelsInitialized) {
      mediapipe.destroy();
      if (needsHands) mediapipe.destroyHands();
    }
  });

  function requestDetectionLoop() {
    animFrameId = requestAnimationFrame(detectionLoop);
  }

  function fireDetectionEvents() {
    fireElementEvents(element, "detection", {
      gesture,
      detected: true,
      timestamp: Date.now(),
      heldFor: duration,
    });
  }

  function detectionLoop() {
    if (fired) return;

    if (videoEl && videoEl.readyState >= 2) {
      if (showOverlay && canvasEl) {
        canvasEl.width = videoEl.videoWidth;
        canvasEl.height = videoEl.videoHeight;
      }

      const detection = mediapipe.detect(videoEl);
      if (detection) {
        const isTriggered = detectGesture(
          gesture,
          detection.landmarks,
          detection.hands,
          threshold,
        );
        detected = isTriggered;

        // Render overlay if enabled
        if (showOverlay && canvasEl) {
          const ctx = canvasEl.getContext("2d");
          if (ctx) {
            const result = validateFov(detection.landmarks, {
              mode: "preset",
              preset: "upper-body",
              confidenceThreshold: threshold,
            });
            renderGuides(ctx, result, { mode: "preset", preset: "upper-body" }, detection.landmarks, {
              width: canvasEl.width,
              height: canvasEl.height,
            });
          }
        }

        // Handle hold timer
        if (isTriggered) {
          if (holdStartTime == null) {
            holdStartTime = performance.now();
          }
          const elapsed = performance.now() - holdStartTime;
          holdRemaining = Math.max(0, duration - elapsed);
          if (elapsed >= duration) {
            fired = true;
            fireDetectionEvents();
            return;
          }
        } else {
          holdStartTime = null;
          holdRemaining = 0;
        }
      }
    }

    requestDetectionLoop();
  }
</script>

{#if showOverlay}
  <div class="el-body-detector">
    <div class="video-container">
      <video bind:this={videoEl} autoplay muted playsinline></video>
      <canvas bind:this={canvasEl}></canvas>
    </div>
    <div class="status">
      {#if error}
        <p class="error">{error}</p>
      {:else if fired}
        <p class="success">Gesture detected.</p>
      {:else if detected}
        <p class="holding">Hold... {(holdRemaining / 1000).toFixed(1)}s</p>
      {:else}
        <p class="waiting">Waiting for: {gesture.replace(/-/g, " ")}</p>
      {/if}
    </div>
  </div>
{:else}
  <!-- Hidden detector — no video feed shown -->
  <video bind:this={videoEl} autoplay muted playsinline class="hidden-video"></video>
  {#if error}
    <p class="error">{error}</p>
  {/if}
{/if}

<style>
  .el-body-detector {
    text-align: center;
    margin: 0.5rem 0;
  }
  .video-container {
    position: relative;
    width: 100%;
    max-width: 320px;
    margin: 0 auto;
    border: 2px solid var(--gray-200);
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--black);
  }
  video {
    display: block;
    width: 100%;
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
  .hidden-video {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
  .status {
    margin-top: 0.25rem;
  }
  .status p {
    font-size: 13px;
    margin: 0;
  }
  .waiting { color: var(--gray-500); }
  .holding { color: var(--accent); font-weight: 600; }
  .success { color: var(--success); font-weight: 600; }
  .error { color: var(--danger); font-size: 13px; }
</style>
