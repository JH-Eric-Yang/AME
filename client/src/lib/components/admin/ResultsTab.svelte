<script lang="ts">
  import { onMount } from "svelte";
  import * as api from "$lib/api";

  let { experimentId }: { experimentId: string } = $props();

  let results: Record<string, unknown>[] = $state([]);
  let loading = $state(true);

  onMount(async () => {
    try {
      results = (await api.listResults(experimentId)) as Record<string, unknown>[];
    } catch {
      // ignore
    } finally {
      loading = false;
    }
  });

  let exportError = $state("");

  async function download(kind: api.ExportKind) {
    exportError = "";
    try {
      await api.downloadExport(experimentId, kind);
    } catch (err) {
      exportError = `The export did not start: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
</script>

<div class="results-tab">
  <div class="header">
    <h2>Results ({results.length})</h2>
    <div class="actions">
      <button onclick={() => download("csv")}>Export CSV</button>
      <button onclick={() => download("files")}>Export recordings and files (ZIP)</button>
    </div>
  </div>
  {#if exportError}
    <p class="error">{exportError}</p>
  {/if}

  {#if loading}
    <p class="muted">Loading...</p>
  {:else if results.length === 0}
    <p class="muted">No results yet.</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Response ID</th>
          <th>Progress</th>
          <th>Trial</th>
          <th>Routine</th>
          <th>Response</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        {#each results as r}
          <tr>
            <td class="mono">{(r.responseId as string).slice(0, 8)}</td>
            <td>{r.progress}</td>
            <td>{r.trial}</td>
            <td>{r.routine}</td>
            <td class="mono">{JSON.stringify(r.response).slice(0, 60)}</td>
            <td class="mono">{new Date(r.createdAt as string).toLocaleString()}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .results-tab { padding: 1.5rem; }
  .error { font-size: 13px; color: var(--danger); margin: 0 0 1rem; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
  h2 { font-size: 16px; font-weight: 600; margin: 0; }
  .actions { display: flex; gap: 0.5rem; }
  .actions button { font-size: 13px; padding: 0.35rem 0.75rem; border: 1px solid var(--gray-200); border-radius: var(--radius-sm); background: #fff; cursor: pointer; }
  .actions button:hover { background: var(--gray-50); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 0.5rem; border: 1px solid var(--gray-200); text-align: left; }
  th { background: var(--gray-50); font-weight: 500; }
  .mono { font-family: monospace; font-size: 12px; }
  .muted { color: var(--gray-400); font-size: 14px; }
</style>
