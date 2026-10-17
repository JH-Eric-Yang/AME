<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { ElementConfig, ElementEvent, VolumeCheckParams } from "ame-shared";
  import { recordAndFire } from "$lib/elements/fireEvents";

  let { element }: { element: ElementConfig } = $props();
  const p = $derived(element.params as VolumeCheckParams);

  let level = $state(0);
  let passed = $state(false);

  /**
   * Declared `detection` events win; `params.action` stays supported as a
   * shorthand so existing experiments keep working.
   */
  function thresholdEvents(): ElementEvent[] {
    const declared = (element.events ?? []).filter((e) => e.trigger === "detection");
    if (declared.length > 0) return declared;
    return [{ trigger: "detection", type: p.action ?? "data", params: { message: p.message } }];
  }
  let stream: MediaStream | null = null;
  let analyser: AnalyserNode | null = null;
  let animFrame: number | null = null;

  onMount(async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      function tick() {
        analyser!.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        level = avg;
        if (avg >= (p.threshold ?? 30) && !passed) {
          passed = true;
          const value = { level: Math.round(avg), passed: true, timestamp: Date.now() };
          recordAndFire({ ...element, events: thresholdEvents() }, "detection", value);
        }
        animFrame = requestAnimationFrame(tick);
      }
      tick();
    } catch {
      // mic denied
    }
  });

  onDestroy(() => {
    if (animFrame) cancelAnimationFrame(animFrame);
    stream?.getTracks().forEach((t) => t.stop());
  });
</script>

<div class="el-volume-check">
  <p>{p.message ?? "Please speak to check your microphone."}</p>
  <div class="meter">
    <div class="fill" style="width: {Math.min(100, (level / 128) * 100)}%"></div>
  </div>
  {#if passed}
    <p class="success">Microphone working.</p>
  {/if}
</div>

<style>
  .el-volume-check { text-align: center; }
  .el-volume-check p { font-size: 14px; margin: 0.5rem 0; }
  .meter {
    width: 100%;
    max-width: 300px;
    height: 8px;
    background: var(--gray-200);
    border-radius: var(--radius-sm);
    overflow: hidden;
    margin: 0.5rem auto;
  }
  .fill {
    height: 100%;
    background: var(--black);
    transition: width 0.1s;
  }
  .success { color: var(--success); font-weight: 600; }
</style>
