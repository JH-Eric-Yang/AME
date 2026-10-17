<script lang="ts">
  import type { StoredErrorGroup, StoredErrorEvent } from "ame-shared/errors";

  let {
    groups,
    showExperiment = false,
    loadEvents,
    onresolve,
    onreopen,
  }: {
    groups: StoredErrorGroup[];
    showExperiment?: boolean;
    loadEvents: (groupId: string) => Promise<StoredErrorEvent[]>;
    onresolve: (groupId: string) => Promise<void>;
    onreopen: (groupId: string) => Promise<void>;
  } = $props();

  let openId = $state("");
  let events = $state<StoredErrorEvent[]>([]);
  let loadingEvents = $state(false);
  let eventsError = $state("");

  /**
   * Bumped on every open/close so a slower, superseded fetch can never paint
   * its result under a group the participant is no longer looking at (or has
   * moved on from) — same shape as the generation guard in webrtc/callSession.ts.
   */
  let generation = 0;

  async function toggle(groupId: string) {
    if (openId === groupId) {
      openId = "";
      generation += 1;
      actionErrorId = "";
      actionError = "";
      return;
    }
    openId = groupId;
    loadingEvents = true;
    eventsError = "";
    actionErrorId = "";
    actionError = "";
    const mine = ++generation;
    try {
      const loaded = await loadEvents(groupId);
      if (mine !== generation) return;
      events = loaded;
    } catch (e) {
      if (mine !== generation) return;
      events = [];
      eventsError = e instanceof Error ? e.message : "Could not load occurrences for this error.";
    } finally {
      if (mine === generation) loadingEvents = false;
    }
  }

  /**
   * Which group a resolve/reopen is in flight for. A global lock, not a
   * per-row one: every action button across every group disables while any
   * one is in flight, because switching to a different (closed-then-reopened)
   * group while an action is still pending must not present that group's
   * button as clickable — it would silently no-op via the guard below.
   */
  let busyId = $state("");
  let actionErrorId = $state("");
  let actionError = $state("");

  async function runAction(groupId: string, action: (id: string) => Promise<void>) {
    if (busyId) return;
    busyId = groupId;
    actionErrorId = "";
    actionError = "";
    try {
      await action(groupId);
    } catch (e) {
      actionErrorId = groupId;
      actionError = e instanceof Error ? e.message : "Could not update that error's status. Try again.";
    } finally {
      busyId = "";
    }
  }
</script>

{#if groups.length === 0}
  <p class="empty">No errors recorded.</p>
{:else}
  <ul class="groups">
    {#each groups as group (group.id)}
      <li class="group">
        <button class="row" onclick={() => toggle(group.id)} aria-expanded={openId === group.id}>
          <span class="badge">{group.status === "OPEN" ? "Open" : "Resolved"}</span>
          <span class="message">{group.message}</span>
          <span class="meta">{group.source}</span>
          {#if showExperiment}
            <span class="meta">{group.experimentId ?? "Platform"}</span>
          {/if}
          <span class="meta">{group.count} ×</span>
          <span class="meta">{group.participantCount} participants</span>
          <span class="meta">{new Date(group.lastSeenAt).toLocaleString()}</span>
        </button>

        {#if openId === group.id}
          <div class="detail">
            <div class="actions">
              {#if group.status === "OPEN"}
                <button disabled={busyId !== ""} onclick={() => runAction(group.id, onresolve)}>
                  {busyId === group.id ? "Resolving…" : "Resolve"}
                </button>
              {:else}
                <button disabled={busyId !== ""} onclick={() => runAction(group.id, onreopen)}>
                  {busyId === group.id ? "Reopening…" : "Reopen"}
                </button>
              {/if}
              {#if actionErrorId === group.id}
                <span class="action-error">{actionError}</span>
              {/if}
            </div>

            {#if loadingEvents}
              <p class="empty">Loading occurrences…</p>
            {:else if eventsError}
              <p class="empty error">{eventsError}</p>
            {:else}
              {#each events as event (event.id)}
                <article class="event">
                  <p class="meta">
                    {new Date(event.occurredAt).toLocaleString()}
                    · participant {event.participantId ?? "—"}
                    · {event.routine ?? "—"} (step {event.progress ?? "—"})
                  </p>
                  {#if event.stack}
                    <div class="stack-scroll"><pre>{event.stack}</pre></div>
                  {/if}
                </article>
              {/each}
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .empty {
    color: var(--gray-400);
    font-size: 13px;
  }

  .empty.error {
    color: var(--danger);
  }

  .groups {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--gray-200);
  }

  .group {
    border-bottom: 1px solid var(--gray-200);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.6rem;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    font-size: 13px;
  }

  .row:hover {
    background: var(--white);
  }

  .badge {
    border: 1px solid currentColor;
    padding: 0 0.4rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .message {
    font-weight: 600;
    flex: 1 1 auto;
    min-width: 12ch;
  }

  /* Status reads as a word (the badge text), never as colour alone. */
  .meta {
    color: var(--gray-600);
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .detail {
    padding: 0 0.6rem 1rem 0.6rem;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.6rem;
  }

  .actions button {
    font-size: 13px;
    padding: 0.3rem 0.7rem;
    background: var(--black);
    color: #fff;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .actions button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .action-error {
    font-size: 0.8rem;
    color: var(--danger);
  }

  .event {
    padding: 0.5rem 0;
    border-top: 1px solid var(--gray-100);
  }

  .stack-scroll {
    overflow-x: auto;
    margin-top: 0.35rem;
    background: var(--gray-50);
    padding: 0.5rem;
  }

  pre {
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    margin: 0;
    white-space: pre;
  }
</style>
