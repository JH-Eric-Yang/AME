<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { DisappearMode } from "ame-shared";
  import type { Snippet } from "svelte";

  let {
    onsetTime = 0,
    duration = null,
    disappearMode = "removed",
    routineStartTime,
    children,
  }: {
    onsetTime?: number;
    duration?: number | null;
    disappearMode?: DisappearMode;
    routineStartTime: number;
    children: Snippet;
  } = $props();

  const hasOnset = onsetTime > 0;
  const hasDuration = duration != null && duration > 0;

  let visible = $state(!hasOnset);
  let expired = $state(false);
  let onsetTimer: ReturnType<typeof setTimeout> | null = null;
  let durationTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    const elapsed = Date.now() - routineStartTime;
    const effectiveOnset = hasOnset ? onsetTime : 0;

    // Handle onset
    if (hasOnset) {
      const remaining = effectiveOnset - elapsed;
      if (remaining <= 0) {
        visible = true;
      } else {
        onsetTimer = setTimeout(() => {
          visible = true;
        }, remaining);
      }
    }

    // Handle duration (measured from onset, not from routine start)
    if (hasDuration) {
      const hideAt = effectiveOnset + duration!;
      const remainingUntilHide = hideAt - elapsed;
      if (remainingUntilHide <= 0) {
        expired = true;
        if (disappearMode === "removed") visible = false;
      } else {
        durationTimer = setTimeout(() => {
          expired = true;
          if (disappearMode === "removed") {
            visible = false;
          }
        }, remainingUntilHide);
      }
    }
  });

  onDestroy(() => {
    if (onsetTimer) clearTimeout(onsetTimer);
    if (durationTimer) clearTimeout(durationTimer);
  });

  const isHidden = $derived(expired && disappearMode === "visibility");
</script>

{#if visible}
  <div class="timed-element" style:visibility={isHidden ? "hidden" : "visible"}>
    {@render children()}
  </div>
{/if}
