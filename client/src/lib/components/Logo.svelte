<script lang="ts">
  /**
   * The AME mark: a webcam built from the three family shapes.
   * Body = Response (square, black). Lens = Stimulus (circle, orange).
   * Stand = Monitor (triangle, grey). The same SVG is static/favicon.svg.
   */
  let { size = 24, wordmark = false }: { size?: number; wordmark?: boolean } = $props();
</script>

<span class="logo" style="--size: {size}px">
  <svg width={size} height={size} viewBox="0 0 56 56" aria-hidden="true">
    <rect x="10" y="4" width="36" height="34" rx="9" style="fill: var(--family-response)" />
    <circle cx="28" cy="21" r="10" style="fill: var(--family-stimulus)" />
    <path d="M28 38 L50 52 H6 Z" style="fill: var(--family-monitor)" />
  </svg>
  {#if wordmark}<span class="wordmark">AME</span>{/if}
</span>

<style>
  .logo { display: inline-flex; align-items: center; gap: calc(var(--size) * 0.3); color: var(--black); }
  .logo svg { display: block; flex-shrink: 0; }
  .wordmark {
    font-family: var(--font-body);
    font-weight: 800;
    font-size: calc(var(--size) * 0.75);
    letter-spacing: -0.03em;
    line-height: 1;
  }
</style>
