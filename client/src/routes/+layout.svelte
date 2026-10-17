<script lang="ts">
  let { children } = $props();
</script>

<svelte:head>
  <title>AME — Autonomous Multimodal Experiment System</title>
  <meta name="description" content="AME — design and run online behavioural experiments with multimodal capture and manipulated video chat, without an experimenter in the room." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
</svelte:head>

{@render children()}

<style>
  :global(:root) {
    --black: #0a0a0a;
    --white: #fafafa;
    --gray-50: #f5f5f5;
    --gray-100: #efefef;
    --gray-200: #e0e0e0;
    --gray-300: #c4c4c4;
    --gray-400: #999;
    --gray-500: #777;
    --gray-600: #555;
    --gray-700: #333;
    --accent: #ff3d00;
    --accent-dim: rgba(255, 61, 0, 0.08);
    --danger: #cc0000;
    --danger-dim: rgba(204, 0, 0, 0.08);
    /* Status only ("in position", "approved", "connected"): never a brand or family colour. */
    --success: #1f8a3a;
    --success-dim: rgba(31, 138, 58, 0.1);
    /* Element families. One shape and one colour each; see shared/src/elementFamilies.ts. */
    --family-stimulus: var(--accent);
    --family-response: var(--black);
    --family-monitor: var(--gray-300);
    --font-display: 'JetBrains Mono', monospace;
    --font-body: 'Outfit', sans-serif;
    --radius-sm: 6px;
    --radius: 10px;
    --radius-lg: 16px;
    --radius-pill: 999px;
    /* The Builder canvas sits on this dot grid. */
    --dot-grid: radial-gradient(var(--gray-200) 1px, transparent 1px);
    --transition: 180ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  :global(body) {
    margin: 0;
    font-family: var(--font-body);
    font-size: 14px;
    line-height: 1.6;
    color: var(--black);
    background: var(--white);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  :global(*) {
    box-sizing: border-box;
  }

  :global(a) {
    color: inherit;
    text-decoration: none;
  }

  :global(::selection) {
    background: var(--accent);
    color: var(--white);
  }

  :global(button) {
    font-family: var(--font-body);
  }

  :global(input, textarea, select) {
    font-family: var(--font-body);
  }

  :global(.mono) {
    font-family: var(--font-display);
  }

  /* Scrollbar */
  :global(::-webkit-scrollbar) {
    width: 6px;
    height: 6px;
  }
  :global(::-webkit-scrollbar-track) {
    background: transparent;
  }
  :global(::-webkit-scrollbar-thumb) {
    background: var(--gray-300);
    border-radius: var(--radius-sm);
  }
  :global(::-webkit-scrollbar-thumb:hover) {
    background: var(--gray-400);
  }

  @media (prefers-reduced-motion: reduce) {
    :global(:root) {
      --transition: 0ms;
    }
  }
</style>
