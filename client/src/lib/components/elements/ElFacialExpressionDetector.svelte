<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { ElementConfig, FacialExpressionDetectorParams } from "ame-shared";
  import { runner } from "$lib/stores/runner";
  import { recordAndFire } from "$lib/elements/fireEvents";
  import * as mediapipe from "$lib/detection/mediapipe-service";
  import {
    scoreExpression,
    createHoldState,
    updateHold,
    type HoldState,
  } from "$lib/detection/expression-classifier";

  const DefaultExpression = "smile";
  const DefaultThreshold = 0.5;
  const DefaultDuration = 500;
  const DefaultSampleRate = 10;

  interface LogSample {
    /** Milliseconds from the start of the routine. */
    t: number;
    scores: Record<string, number>;
  }

  let { element }: { element: ElementConfig } = $props();
  const p = $derived(element.params as FacialExpressionDetectorParams);

  const mode = $derived(p.mode ?? "trigger");
  const expression = $derived(p.expression ?? DefaultExpression);
  const threshold = $derived(p.threshold ?? DefaultThreshold);
  const duration = $derived(p.duration ?? DefaultDuration);
  const showOverlay = $derived(p.showOverlay ?? false);
  const sampleIntervalMs = $derived(1000 / (p.sampleRate ?? DefaultSampleRate));

  let videoEl: HTMLVideoElement;
  let stream: MediaStream | null = null;
  let animFrameId: number | null = null;

  let hold: HoldState = createHoldState();
  let fired = $state(false);
  let score = $state(0);
  let faceVisible = $state(false);
  let error = $state<string | null>(null);

  const samples: LogSample[] = [];
  let lastSampleAt = 0;
  let samplesRegistered = false;
  let destroyed = false;
  let faceInitialized = false;

  onMount(async () => {
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });

      // The routine can end while getUserMedia is still resolving; without this
      // the tracks are never stopped and the participant's camera stays on.
      if (destroyed) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = media;

      if (videoEl) {
        videoEl.srcObject = stream;
        await videoEl.play();
      }

      await mediapipe.initializeFace();
      if (destroyed) {
        mediapipe.destroyFace();
        return;
      }
      faceInitialized = true;

      animFrameId = requestAnimationFrame(detectionLoop);
    } catch (err) {
      error = `Camera error: ${err instanceof Error ? err.message : "unknown"}`;
    }
  });

  onDestroy(() => {
    destroyed = true;
    if (animFrameId != null) cancelAnimationFrame(animFrameId);
    stream?.getTracks().forEach((t) => t.stop());
    if (faceInitialized) mediapipe.destroyFace();
  });

  function recordSample(blendshapes: { categoryName: string; score: number }[], now: number) {
    if (now - lastSampleAt < sampleIntervalMs) return;
    lastSampleAt = now;

    const wanted = p.blendshapes ?? [];
    const scores: Record<string, number> = {};
    for (const shape of blendshapes) {
      if (wanted.length === 0 || wanted.includes(shape.categoryName)) {
        scores[shape.categoryName] = shape.score;
      }
    }

    samples.push({ t: Math.round(Date.now() - $runner.routineStartTime), scores });

    // Register the array once and then mutate it. Calling setResponse per sample
    // would re-render every subscriber at the sample rate, which competes with
    // video recording for frame budget.
    if (!samplesRegistered) {
      samplesRegistered = true;
      runner.setResponse(element.name, { mode: "log", samples });
    }
  }

  function detectionLoop() {
    // In trigger mode there is nothing left to watch for once the event fired.
    if (mode === "trigger" && fired) return;

    if (videoEl && videoEl.readyState >= 2) {
      const detection = mediapipe.detectFace(videoEl);
      faceVisible = detection !== null;

      if (detection) {
        const now = performance.now();

        if (mode === "log") {
          recordSample(detection.blendshapes, now);
        } else {
          score = scoreExpression(expression, detection.blendshapes);
          const result = updateHold(hold, score, threshold, duration, now);
          hold = result.state;

          if (result.fired) {
            fired = true;
            const value = {
              expression,
              score,
              detected: true,
              heldFor: Math.round(result.heldFor),
              timestamp: Date.now(),
            };
            recordAndFire(element, "detection", value);
            return;
          }
        }
      }
    }

    animFrameId = requestAnimationFrame(detectionLoop);
  }
</script>

<div class="el-face-expression" class:hidden={!showOverlay}>
  <video bind:this={videoEl} autoplay muted playsinline></video>

  {#if showOverlay}
    <div class="status">
      {#if error}
        <p class="error">{error}</p>
      {:else if !faceVisible}
        <p class="waiting">No face detected.</p>
      {:else if mode === "log"}
        <p class="waiting">Recording expressions&hellip;</p>
      {:else if fired}
        <p class="success">{expression.replace(/-/g, " ")} detected.</p>
      {:else}
        <p class="waiting">Waiting for: {expression.replace(/-/g, " ")}</p>
        <div class="meter">
          <div class="fill" style="width: {Math.round(score * 100)}%"></div>
          <div class="threshold" style="left: {Math.round(threshold * 100)}%"></div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .el-face-expression {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
  }
  .el-face-expression.hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  video {
    width: 100%;
    max-width: 480px;
    border-radius: var(--radius-sm);
    transform: scaleX(-1);
    background: var(--black);
  }
  .status {
    text-align: center;
    font-size: 14px;
    width: 100%;
    max-width: 480px;
  }
  .status p {
    margin: 0 0 0.5rem;
  }
  .error {
    color: var(--danger);
  }
  .success {
    color: var(--success);
  }
  .waiting {
    color: var(--gray-500);
  }
  .meter {
    position: relative;
    height: 6px;
    background: var(--gray-100);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--black);
    transition: width 80ms linear;
  }
  .threshold {
    position: absolute;
    top: 0;
    width: 2px;
    height: 100%;
    background: var(--danger);
  }
</style>
