<script lang="ts">
  import { onMount } from "svelte";
  import type { StoredErrorGroup } from "ame-shared/errors";
  import * as api from "$lib/api";
  import ErrorGroupList from "$lib/components/admin/errors/ErrorGroupList.svelte";

  /** The list reloads on this cadence while the page is mounted, plus on demand. */
  const RefreshMs = 30_000;

  type Scope = "all" | "platform";
  type Status = "open" | "resolved" | "all";

  let groups = $state<StoredErrorGroup[]>([]);
  let loading = $state(true);
  let loadError = $state("");
  let scope = $state<Scope>("all");
  let status = $state<Status>("open");

  /**
   * `keepStaleOnError` distinguishes a background refresh (same scope/status,
   * already-shown data is still correct for what the filter buttons say) from
   * a scope/status switch (the active filter button has already changed, so
   * the previous selection's data — if kept — would sit on screen under the
   * wrong label). A refresh keeps the list and adds a small notice; a filter
   * switch clears it and falls back to the full error state instead.
   */
  async function load(keepStaleOnError = true) {
    loading = true;
    loadError = "";
    try {
      groups = await api.listPlatformErrors(scope, status);
    } catch (error) {
      loadError =
        error instanceof api.ApiError && error.status === 403
          ? "The platform error log is visible to administrators only."
          : "Could not load errors. Try again in a moment.";
      if (!keepStaleOnError) groups = [];
    } finally {
      loading = false;
    }
  }

  function setScope(next: Scope) {
    scope = next;
    void load(false);
  }

  function setStatus(next: Status) {
    status = next;
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
  }

  async function handleReopen(groupId: string) {
    const updated = await api.reopenError(groupId);
    groups = groups.map((g) => (g.id === groupId ? updated : g));
  }
</script>

<div class="page">
  <div class="page-header">
    <div>
      <h1>Errors</h1>
      <p class="page-sub">Server and browser failures across the platform.</p>
    </div>
    <button class="refresh" onclick={() => void load()} disabled={loading}>
      {loading ? "Refreshing…" : "Refresh"}
    </button>
  </div>

  <div class="filter-bar">
    <span class="filter-group">
      <button class="filter-btn" class:active={scope === "all"} onclick={() => setScope("all")}>All</button>
      <button class="filter-btn" class:active={scope === "platform"} onclick={() => setScope("platform")}>Platform</button>
    </span>
    <span class="filter-group">
      <button class="filter-btn" class:active={status === "open"} onclick={() => setStatus("open")}>Open</button>
      <button class="filter-btn" class:active={status === "resolved"} onclick={() => setStatus("resolved")}>Resolved</button>
      <button class="filter-btn" class:active={status === "all"} onclick={() => setStatus("all")}>All</button>
    </span>
  </div>

  {#if loading && groups.length === 0}
    <div class="empty-state">
      <div class="loading-pulse"></div>
      <p>Loading errors...</p>
    </div>
  {:else if loadError && groups.length === 0}
    <div class="empty-state">
      <p class="error">{loadError}</p>
      <button class="filter-btn" onclick={() => void load()}>Try again</button>
    </div>
  {:else}
    {#if loadError}
      <p class="notice">Couldn't refresh — showing the last loaded list. ({loadError})</p>
    {/if}
    <ErrorGroupList
      groups={groups}
      showExperiment
      loadEvents={api.listErrorEvents}
      onresolve={handleResolve}
      onreopen={handleReopen}
    />
  {/if}
</div>

<style>
  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 1.5rem;
  }
  h1 { font-family: var(--font-display); font-size: 22px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 0.25rem; }
  .page-sub { font-size: 13px; color: var(--gray-400); margin: 0; }

  .refresh {
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.03em;
    padding: 0.4rem 0.75rem;
    background: none;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    color: var(--gray-500);
    cursor: pointer;
    transition: all var(--transition);
  }
  .refresh:hover:not(:disabled) { border-color: var(--black); color: var(--black); }
  .refresh:disabled { opacity: 0.5; cursor: default; }

  .filter-bar { display: flex; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
  .filter-group { display: flex; gap: 0.25rem; }
  .filter-btn {
    font-family: var(--font-display); font-size: 12px; font-weight: 500; letter-spacing: 0.03em;
    padding: 0.4rem 0.75rem; background: none; border: 1px solid var(--gray-200);
    border-radius: var(--radius); color: var(--gray-500); cursor: pointer;
    transition: all var(--transition);
  }
  .filter-btn:hover { border-color: var(--black); color: var(--black); }
  .filter-btn.active { background: var(--black); color: var(--white); border-color: var(--black); }

  .empty-state { display: flex; flex-direction: column; align-items: center; gap: 0.75rem; padding: 3rem; text-align: center; }
  .empty-state p { font-size: 14px; color: var(--gray-500); margin: 0; }
  .empty-state .error { color: var(--accent); }

  .notice { color: var(--accent); font-size: 12px; margin: 0 0 0.75rem; }
  .loading-pulse { width: 32px; height: 32px; border: 2px solid var(--gray-200); border-top-color: var(--black); border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
