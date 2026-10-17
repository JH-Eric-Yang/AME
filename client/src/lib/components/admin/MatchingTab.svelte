<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { connectAdminSocket, disconnectAdminSocket } from "$lib/socket/adminSocket";
  import { listSessions } from "$lib/api";
  import { participantLabel, formatWaitTime } from "$lib/admin/queueRows";
  import SessionsPanel from "./session/SessionsPanel.svelte";
  import type {
    QueueEntry,
    QueueStatePayload,
    QueueUpdatePayload,
    SessionStatePayload,
    SessionSummary,
    SessionUpdatePayload,
  } from "ame-shared";

  /** Wait times are counted in whole seconds, so this is the coarsest tick that never skips one. */
  const TickIntervalMs = 1000;

  let { experimentId }: { experimentId: string } = $props();

  let queues = $state<Map<string, QueueEntry[]>>(new Map());
  let sessions = $state<SessionSummary[]>([]);
  let connected = $state(false);
  /**
   * Re-read once a second. formatWaitTime is a function of this, not of
   * Date.now(), so a queue that emits no events still counts up — a cohort
   * waiting for its eighth member used to show a frozen wait.
   */
  let now = $state(Date.now());
  let tick: ReturnType<typeof setInterval> | null = null;

  const subscribe = (socket: ReturnType<typeof connectAdminSocket>) => {
    socket.emit("queue:subscribe", { experimentId });
    socket.emit("session:subscribe", { experimentId });
  };

  const mergeSession = (incoming: SessionSummary): SessionSummary[] => {
    const index = sessions.findIndex((s) => s.sessionId === incoming.sessionId);
    if (index === -1) return [incoming, ...sessions];
    return sessions.map((s) => (s.sessionId === incoming.sessionId ? incoming : s));
  };

  onMount(() => {
    tick = setInterval(() => {
      now = Date.now();
    }, TickIntervalMs);

    // Paint whatever is already running before the socket handshake completes.
    listSessions(experimentId)
      .then((loaded) => {
        if (sessions.length === 0) sessions = loaded;
      })
      .catch((err) => console.error("[MatchingTab] Failed to load sessions:", err));

    const socket = connectAdminSocket();

    socket.on("connect", () => {
      connected = true;
      subscribe(socket);
    });

    socket.on("queue:state", (data: QueueStatePayload) => {
      queues = new Map(data.rooms.map((room) => [room.routineName, room.entries]));
    });

    socket.on("queue:update", (data: QueueUpdatePayload) => {
      queues = new Map(queues).set(data.routineName, data.entries);
    });

    socket.on("session:state", (data: SessionStatePayload) => {
      sessions = data.sessions;
    });

    socket.on("session:update", (data: SessionUpdatePayload) => {
      sessions = mergeSession(data.session);
    });

    socket.on("disconnect", () => {
      connected = false;
    });

    if (socket.connected) {
      connected = true;
      subscribe(socket);
    }
  });

  onDestroy(() => {
    if (tick) clearInterval(tick);
    const socket = connectAdminSocket();
    socket.emit("queue:unsubscribe", { experimentId });
    socket.emit("session:unsubscribe", { experimentId });
    disconnectAdminSocket();
  });

  let totalWaiting = $derived(
    Array.from(queues.values()).reduce((sum, entries) => sum + entries.length, 0),
  );
</script>

<div class="matching-tab">
  <div class="status-bar">
    <span class="indicator" class:online={connected}></span>
    {connected ? "Live" : "Connecting..."}
    — {totalWaiting} participant{totalWaiting !== 1 ? "s" : ""} waiting
  </div>

  {#if queues.size === 0}
    <p class="empty">No active matching queues.</p>
  {:else}
    {#each Array.from(queues.entries()) as [routineName, entries] (routineName)}
      <section class="queue-section">
        <h4>{routineName} ({entries.length})</h4>
        {#if entries.length === 0}
          <p class="muted">Queue empty</p>
        {:else}
          <table>
            <thead>
              <tr>
                <th>Participant</th>
                <th>Condition</th>
                <th>Waiting</th>
              </tr>
            </thead>
            <tbody>
              {#each entries as entry (entry.participantId)}
                <tr>
                  <td><code>{participantLabel(entry)}</code></td>
                  <td>{entry.condition ?? "—"}</td>
                  <td>{formatWaitTime(entry.joinedAt, now)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </section>
    {/each}
  {/if}

  <SessionsPanel {sessions} />
</div>

<style>
  .matching-tab {
    padding: 1rem;
  }

  .status-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
    font-size: 13px;
    color: var(--gray-500);
  }

  .indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--gray-300);
  }

  .indicator.online {
    background: var(--black);
  }

  .empty {
    color: var(--gray-400);
    font-size: 14px;
  }

  .queue-section {
    margin-bottom: 1.5rem;
  }

  .queue-section h4 {
    margin-bottom: 0.5rem;
    border-bottom: 1px solid var(--gray-200);
    padding-bottom: 0.25rem;
  }

  .muted {
    color: var(--gray-400);
    font-size: 13px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  th {
    text-align: left;
    border-bottom: 1px solid var(--black);
    padding: 0.25rem 0.5rem;
    font-weight: 600;
  }

  td {
    padding: 0.25rem 0.5rem;
    border-bottom: 1px solid var(--gray-100);
  }

  code {
    font-size: 12px;
    background: var(--gray-50);
    padding: 1px 4px;
  }
</style>
