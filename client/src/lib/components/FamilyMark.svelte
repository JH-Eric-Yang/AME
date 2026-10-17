<script lang="ts">
  import type { ElementFamily } from "ame-shared/elementFamilies";

  /**
   * The one place the three family shapes are drawn. Stimulus is a circle,
   * Response a square, Monitor a triangle. `size` is any CSS length and
   * defaults to 0.6em so the mark follows the text beside it.
   */
  let { family, size = "0.6em" }: { family: ElementFamily; size?: string } = $props();
</script>

<svg class="mark {family}" style="--size: {size}" viewBox="0 0 10 10" aria-hidden="true">
  {#if family === "stimulus"}
    <circle cx="5" cy="5" r="5" />
  {:else if family === "response"}
    <rect x="0" y="0" width="10" height="10" rx="1.8" />
  {:else}
    <path d="M5 0.5 L10 9.5 H0 Z" />
  {/if}
</svg>

<style>
  .mark {
    display: inline-block;
    width: var(--size);
    height: var(--size);
    flex-shrink: 0;
    vertical-align: -0.1em;
  }
  /* The family colour is for the shape only; it is never used for text. */
  .stimulus { fill: var(--family-stimulus); }
  .response { fill: var(--family-response); }
  .monitor { fill: var(--family-monitor); }
</style>
