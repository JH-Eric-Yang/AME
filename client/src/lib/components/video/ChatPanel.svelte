<script lang="ts">
  import { untrack } from "svelte";
  import { transcriptOf } from "ame-shared/videoChat";
  import { runner } from "$lib/stores/runner";
  import { chatThread } from "$lib/chat/chatThread";
  import { speakerLabel } from "$lib/chat/threadLines";

  /** Where this tile's transcript is written in `responses` (see transcriptKey). */
  let { responseKey }: { responseKey: string } = $props();

  /** Matches the server's MaxChatMessageLength. */
  const MaxMessageLength = 2000;

  let draft = $state("");
  let listEl = $state<HTMLDivElement | null>(null);

  // Written on every change rather than on Proceed: submitAndProceed sends the
  // responses before proceedRequested is set, so a write at Proceed is too late.
  $effect(() => {
    const { scope, lines } = $chatThread;
    if (scope === null) return;
    untrack(() => runner.setResponse(responseKey, transcriptOf(lines)));
  });

  $effect(() => {
    $chatThread.lines;
    if (listEl) listEl.scrollTop = listEl.scrollHeight;
  });

  // "" is the server's answer for a step with no thread (a solo seat, or a tile
  // outside a matching block); null is an answer still outstanding.
  const noThread = $derived($chatThread.scope === "");
  const canSend = $derived(Boolean($chatThread.scope));

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!canSend) return;
    chatThread.send(draft);
    draft = "";
  }
</script>

<div class="chat">
  <div class="lines" bind:this={listEl}>
    {#each $chatThread.lines as line (`${line.from}:${line.at}:${line.text}`)}
      <div class="line" class:own={line.from === $runner.participantId}>
        <span class="speaker">{speakerLabel(line, $runner.participantId, $runner.sessionMembers)}</span>
        <span class="text">{line.text}</span>
      </div>
    {/each}
  </div>
  {#if noThread}
    <div class="unavailable">Chat unavailable</div>
  {/if}
  <form class="composer" onsubmit={submit}>
    <input
      type="text"
      aria-label="Message"
      placeholder="Type a message"
      maxlength={MaxMessageLength}
      bind:value={draft}
      disabled={!canSend}
    />
    <button type="submit" disabled={!canSend || !draft.trim()}>Send</button>
  </form>
</div>

<style>
  .chat {
    display: flex;
    flex-direction: column;
    min-height: 200px;
    max-height: 60vh;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-sm);
    background: #fff;
  }
  .lines {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .line { font-size: 14px; }
  .unavailable { padding: 0 0.5rem 0.35rem; color: var(--gray-400); font-size: 12px; }
  .line.own { text-align: right; }
  .speaker { color: var(--gray-500); font-size: 12px; margin-right: 0.35rem; }
  .composer {
    display: flex;
    gap: 0.5rem;
    padding: 0.5rem;
    border-top: 1px solid var(--gray-200);
  }
  .composer input {
    flex: 1;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--gray-300);
    border-radius: var(--radius-sm);
    font-size: 14px;
  }
  .composer button {
    background: var(--black);
    color: #fff;
    border: none;
    border-radius: var(--radius-sm);
    padding: 0.4rem 1rem;
    font-size: 14px;
    cursor: pointer;
  }
  .composer button:disabled { background: var(--gray-400); cursor: default; }
</style>
