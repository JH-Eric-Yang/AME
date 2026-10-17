<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { ElementConfig, ElementEvent, SpeechRecognizerParams } from "ame-shared";
  import { runner } from "$lib/stores/runner";
  import { recordAndFire } from "$lib/elements/fireEvents";

  /* eslint-disable @typescript-eslint/no-explicit-any */
  type SpeechRecognitionAny = any;

  let { element }: { element: ElementConfig } = $props();
  const p = $derived(element.params as SpeechRecognizerParams);

  let transcript = $state("");
  let listening = $state(false);
  let recognition: SpeechRecognitionAny | null = null;
  let fired = false;

  /**
   * Declared `keyword` events win; `params.action` stays supported as a
   * shorthand so existing experiments keep working.
   */
  function keywordEvents(): ElementEvent[] {
    const declared = (element.events ?? []).filter((e) => e.trigger === "keyword");
    if (declared.length > 0) return declared;
    return [{ trigger: "keyword", type: p.action ?? "data" }];
  }

  onMount(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    recognition = new SR();
    recognition.lang = p.language ?? "en-US";
    recognition.continuous = p.continuous ?? false;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      let result = "";
      for (let i = 0; i < event.results.length; i++) {
        result += event.results[i][0].transcript;
      }
      transcript = result;
      runner.setResponse(element.name, transcript);

      // Check for keywords — fire once per routine, on the first match.
      if (!fired && p.keywords?.length) {
        const lower = result.toLowerCase();
        const matched = p.keywords.find((kw) => lower.includes(kw.toLowerCase()));
        if (matched) {
          fired = true;
          recordAndFire({ ...element, events: keywordEvents() }, "keyword", {
            keyword: matched,
            transcript: result,
            timestamp: Date.now(),
          });
        }
      }
    };

    recognition.onend = () => {
      listening = false;
      if (p.continuous) {
        recognition?.start();
      }
    };

    recognition.start();
    listening = true;
  });

  onDestroy(() => {
    recognition?.stop();
  });
</script>

<div class="el-speech">
  <p class="status">{listening ? "Listening..." : "Speech recognition unavailable"}</p>
  {#if transcript}
    <p class="transcript">{transcript}</p>
  {/if}
</div>

<style>
  .el-speech { text-align: center; }
  .status { font-size: 13px; color: var(--gray-400); margin: 0.25rem 0; }
  .transcript { font-size: 14px; padding: 0.5rem; background: var(--gray-50); border-radius: var(--radius-sm); }
</style>
