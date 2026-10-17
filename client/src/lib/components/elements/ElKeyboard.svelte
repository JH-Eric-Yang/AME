<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { ElementConfig, KeyboardParams } from "ame-shared";
  import { runner } from "$lib/stores/runner";
  import { recordAndFire } from "$lib/elements/fireEvents";

  interface KeypressRecord {
    key: string;
    code: string;
    timestamp: number;
    /** Milliseconds from the start of the routine. */
    rt: number;
  }

  let { element }: { element: ElementConfig } = $props();
  const p = $derived(element.params as KeyboardParams);

  let presses: KeypressRecord[] = [];
  let lastKey = $state<string | null>(null);

  function accepts(key: string): boolean {
    const allowed = p.keys ?? [];
    if (allowed.length === 0) return true;

    if (p.caseSensitive) return allowed.includes(key);
    return allowed.some((k) => k.toLowerCase() === key.toLowerCase());
  }

  function handleKeydown(event: KeyboardEvent) {
    // Let participants type into inputs without it counting as a response.
    const target = event.target as HTMLElement | null;
    if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

    if (!accepts(event.key)) return;
    if (p.recordMode !== "all" && presses.length > 0) return;

    if (p.preventDefault) event.preventDefault();

    const record: KeypressRecord = {
      key: event.key,
      code: event.code,
      timestamp: Date.now(),
      rt: Date.now() - $runner.routineStartTime,
    };
    presses.push(record);
    lastKey = record.key;

    const value = p.recordMode === "all" ? [...presses] : record;
    recordAndFire(element, "press", value);
  }

  onMount(() => window.addEventListener("keydown", handleKeydown));
  onDestroy(() => window.removeEventListener("keydown", handleKeydown));
</script>

{#if p.hint}
  <div class="el-keyboard">
    <p class="hint">{p.hint}</p>
    {#if lastKey}
      <p class="last-key">{lastKey}</p>
    {/if}
  </div>
{/if}

<style>
  .el-keyboard {
    text-align: center;
  }
  .hint {
    font-size: 14px;
    color: var(--gray-500);
    margin: 0;
  }
  .last-key {
    margin: 0.5rem 0 0;
    font-family: monospace;
    font-size: 18px;
  }
</style>
