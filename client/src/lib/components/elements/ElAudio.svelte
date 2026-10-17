<script lang="ts">
  import { onMount } from "svelte";
  import type { ElementConfig, AudioParams } from "ame-shared";
  import { resolveSrc } from "$lib/media/assetSrc";
  import { isAutoplayBlock, needsPlayButton } from "$lib/elements/audioPlayback";

  let { element }: { element: ElementConfig } = $props();
  const p = $derived(element.params as AudioParams);

  let audio: HTMLAudioElement | undefined = $state();
  let blocked = $state(false);
  const showPlay = $derived(
    needsPlayButton({ autoplay: p.autoplay ?? false, controls: p.controls ?? true, blocked }),
  );

  // play() instead of the autoplay attribute, so a refusal is seen and the
  // participant gets a Play button when there are no native controls.
  onMount(() => {
    if (!(p.autoplay ?? false) || !audio) return;
    audio.play().catch((error: unknown) => {
      if (isAutoplayBlock(error)) blocked = true;
    });
  });

  function playNow(): void {
    audio
      ?.play()
      .then(() => (blocked = false))
      .catch(() => undefined);
  }
</script>

<div class="el-audio">
  <audio bind:this={audio} src={resolveSrc(p.src)} loop={p.loop ?? false} controls={p.controls ?? true}></audio>
  {#if showPlay}
    <button type="button" class="play" onclick={playNow}>Play</button>
  {/if}
</div>

<style>
  .el-audio { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; }
  audio { width: 100%; max-width: 400px; }
  .play {
    padding: 0.5rem 1.25rem;
    border: 1px solid var(--black);
    border-radius: var(--radius-pill);
    background: var(--black);
    color: var(--white);
    font: inherit;
    cursor: pointer;
  }
</style>
