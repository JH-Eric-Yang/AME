<script lang="ts">
  import { onMount, onDestroy, untrack } from "svelte";
  import type { ElementConfig, TimerParams } from "ame-shared";
  import { DefaultTimerSeconds } from "ame-shared/timer";
  import { fireElementEvents } from "$lib/elements/fireEvents";

  let { element }: { element: ElementConfig } = $props();
  const p = $derived(element.params as TimerParams);
  /** Seconds. A timer dropped from the palette has no Duration (E2E-D7). */
  const duration = $derived(p.duration ?? DefaultTimerSeconds);

  let remaining = $state(untrack(() => p.duration ?? DefaultTimerSeconds));
  let interval: ReturnType<typeof setInterval> | null = null;
  let warning = $derived(p.warningTime ? remaining <= p.warningTime : false);

  onMount(() => {
    remaining = duration;
    interval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        if (interval) clearInterval(interval);
        // Timer expired — fire whatever the element declares for "timeout"
        // (data/proceed/complete/alert), and divert to the phone's sink
        // instead of recording when this page is not the state owner. Uses
        // `fireElementEvents`, not `recordAndFire`: expiry is not a
        // participant answer, so it must not fall back to recording under the
        // element's own name just because no `data` event was declared.
        fireElementEvents(element, "timeout", {
          expired: true,
          duration,
          timestamp: Date.now(),
        });
      }
    }, 1000);
  });

  onDestroy(() => {
    if (interval) clearInterval(interval);
  });

  function formatTime(s: number): string {
    if (p.format === "seconds") return `${Math.max(0, s)}s`;
    const m = Math.floor(Math.max(0, s) / 60);
    const sec = Math.max(0, s) % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }
</script>

{#if p.visible !== false}
  <div class="el-timer" class:warning>
    {#if p.format === "progress-bar"}
      <div class="progress-bar">
        <div class="fill" style="width: {Math.max(0, (remaining / duration) * 100)}%"></div>
      </div>
    {:else}
      <span class="time">{formatTime(remaining)}</span>
    {/if}
  </div>
{/if}

<style>
  .el-timer { text-align: center; margin: 0.5rem 0; }
  .time { font-family: monospace; font-size: 24px; font-weight: 600; }
  .warning .time { color: var(--danger); }
  .progress-bar {
    width: 100%;
    height: 6px;
    background: var(--gray-200);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--black);
    transition: width 1s linear;
  }
  .warning .fill { background: var(--danger); }
</style>
