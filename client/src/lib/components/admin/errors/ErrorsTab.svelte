<script lang="ts">
  import { onMount } from "svelte";
  import type { StoredErrorGroup } from "ame-shared/errors";
  import * as api from "$lib/api";
  import ErrorGroupList from "./ErrorGroupList.svelte";

  /** The list reloads on this cadence while the tab is mounted, plus on demand. */
  const RefreshMs = 30_000;

  type Filter = "open" | "resolved" | "all";

  let {
    experimentId,
    onaction,
  }: {
    experimentId: string;
    /** Called after a resolve/reopen that actually succeeded — lets the parent refresh its own badge count immediately, rather than waiting on its own poll. */
    onaction?: () => void;
  } = $props();

  let filter = $state<Filter>("open");
  let groups = $state<StoredErrorGroup[]>([]);
  let loading = $state(true);
  let loadError = $state("");

  /**
   * `keepStaleOnError` distinguishes a background refresh (same filter,
   * already-shown data is still correct for what the filter buttons say) from
   * a filter switch (the active filter button has already changed, so the
   * previous filter's data — if kept — would sit on screen under the wrong
   * label). A refresh keeps the list and adds a small notice; a filter
   * switch clears it and falls back to the full error state instead.
   */
  async function load(keepStaleOnError = true) {
    loading = true;
    loadError = "";
    try {
      groups = await api.listExperimentErrors(experimentId, filter);
    } catch (e) {
      loadError = e instanceof api.ApiError ? e.message : "Could not load errors. Try again in a moment.";
      if (!keepStaleOnError) groups = [];
    } finally {
      loading = false;
    }
  }

  function setFilter(next: Filter) {
    filter = next;
    void load(false);
  }

  onMount(() => {
    void load();
    const timer = setInterval(() => void load(), RefreshMs);
    return () => clearInterval(timer);
  });

  async function handleResolve(groupId: string) {
    const updated = await api.resolveError(groupId);
    groups = groups.map((g) => (g.id === groupId ? updated : g));
    onaction?.();
  }

  async function handleReopen(groupId: string) {
    const updated = await api.reopenError(groupId);
    groups = groups.map((g) => (g.id === groupId ? updated : g));
    onaction?.();
  }
</script>

<div class="errors-tab">
  <div class="toolbar">
    <div class="filter-bar">
      <button class:active={filter === "open"} onclick={() => setFilter("open")}>Open</button>
      <button class:active={filter === "resolved"} onclick={() => setFilter("resolved")}>Resolved</button>
      <button class:active={filter === "all"} onclick={() => setFilter("all")}>All</button>
    </div>
    <button class="refresh" onclick={() => void load()} disabled={loading}>
      {loading ? "Refreshing…" : "Refresh"}
    </button>
  </div>

  {#if loading && groups.length === 0}
    <p class="muted">Loading…</p>
  {:else if loadError && groups.length === 0}
    <p class="error">{loadError}</p>
  {:else}
    {#if loadError}
      <p class="notice">Couldn't refresh — showing the last loaded list. ({loadError})</p>
    {/if}
    <ErrorGroupList
      {groups}
      loadEvents={api.listErrorEvents}
      onresolve={handleResolve}
      onreopen={handleReopen}
    />
  {/if}
</div>

<style>
  .errors-tab {
    padding: 1rem;
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  .filter-bar {
    display: flex;
    gap: 0.25rem;
  }

  .filter-bar button {
    font-size: 13px;
    padding: 0.35rem 0.75rem;
    background: none;
    border: 1px solid var(--gray-300);
    border-radius: var(--radius-sm);
    color: var(--gray-500);
    cursor: pointer;
  }

  .filter-bar button.active {
    background: var(--black);
    color: #fff;
    border-color: var(--black);
  }

  .refresh {
    font-size: 13px;
    padding: 0.35rem 0.75rem;
    background: none;
    border: 1px solid var(--gray-300);
    border-radius: var(--radius-sm);
    color: var(--gray-500);
    cursor: pointer;
  }

  .refresh:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .muted {
    color: var(--gray-400);
    font-size: 14px;
  }

  .error {
    color: var(--danger);
    font-size: 14px;
  }

  .notice {
    color: var(--danger);
    font-size: 12px;
    margin: 0 0 0.75rem;
  }
</style>
