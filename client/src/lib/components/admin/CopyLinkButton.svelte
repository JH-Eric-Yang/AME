<script lang="ts">
  import { onDestroy } from "svelte";

  /** How long the "Copied" confirmation stays before the label returns. */
  const ConfirmMs = 1500;

  let { text, label = "Copy link", compact = false }: {
    text: string;
    label?: string;
    /** The dashboard card's small uppercase action style. */
    compact?: boolean;
  } = $props();

  let result = $state<"idle" | "copied" | "failed">("idle");
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy(e: MouseEvent) {
    // On the dashboard the button sits inside the card's link: the click must not navigate.
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      result = "copied";
    } catch {
      // No clipboard access (an insecure origin, or the permission was refused).
      result = "failed";
    }
    clearTimeout(timer);
    timer = setTimeout(() => (result = "idle"), ConfirmMs);
  }

  onDestroy(() => clearTimeout(timer));
</script>

<button type="button" class="copy-btn" class:compact title={text} onclick={copy}>
  <span aria-live="polite">{result === "copied" ? "Copied" : result === "failed" ? "Copy failed" : label}</span>
</button>

<style>
  .copy-btn {
    font: inherit;
    font-size: 12px;
    padding: 0.25rem 0.6rem;
    border: 1px solid var(--black);
    border-radius: var(--radius);
    background: var(--white);
    color: var(--black);
    cursor: pointer;
    white-space: nowrap;
  }
  .copy-btn:hover { background: var(--gray-50); }
  .copy-btn.compact {
    font-family: var(--font-display);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.05em;
    padding: 0.2rem 0.5rem;
    border-color: var(--gray-200);
    color: var(--gray-500);
    background: none;
  }
  .copy-btn.compact:hover { border-color: var(--black); color: var(--black); }
</style>
