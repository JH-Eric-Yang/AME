<script lang="ts">
  import { onMount } from "svelte";
  import * as api from "$lib/api";
  import { experiment } from "$lib/stores/experiment";
  import { achievedBalanceLine, experimentAssignsRoles } from "$lib/admin/roleBalance";

  let { experimentId }: { experimentId: string } = $props();

  let participants: Record<string, unknown>[] = $state([]);
  let loading = $state(true);
  let selectedIds: string[] = $state([]);
  let matchRoutine = $state("");
  let matching = $state(false);

  onMount(async () => {
    try {
      participants = (await api.listParticipants(experimentId)) as Record<string, unknown>[];
    } catch {
      // ignore
    } finally {
      loading = false;
    }
  });

  function toggleSelect(id: string) {
    if (selectedIds.includes(id)) {
      selectedIds = selectedIds.filter((i) => i !== id);
    } else {
      selectedIds = [...selectedIds, id];
    }
  }

  async function handleMatch() {
    if (selectedIds.length < 2 || !matchRoutine) return;
    matching = true;
    try {
      await api.manualMatch(experimentId, matchRoutine, selectedIds);
      selectedIds = [];
      matchRoutine = "";
    } catch {
      // ignore
    } finally {
      matching = false;
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this participant?")) return;
    try {
      await api.deleteParticipant(id);
      participants = participants.filter((p) => p.id !== id);
    } catch {
      // ignore
    }
  }

  function statusLabel(p: Record<string, unknown>): string {
    if (p.withdraw) return "Withdrawn";
    if (p.completion) return "Completed";
    if (p.isLoggedIn) return "Online";
    return "Offline";
  }

  // A session that is abandoned still consumed its permutation, so the
  // intended balance and the achieved balance diverge. This counts only
  // participants who COMPLETED — everyone still short of a matching routine
  // is on the schema default of 0 and would otherwise swamp the figure — and
  // is shown only on a study that assigns roles at all.
  const assignsRoles = $derived(experimentAssignsRoles($experiment.routines));
  const balanceLine = $derived(achievedBalanceLine(participants));
</script>

<div class="participants-tab">
  <h2>Participants ({participants.length})</h2>

  {#if selectedIds.length >= 2}
    <div class="match-bar">
      <span>{selectedIds.length} selected</span>
      <input type="text" bind:value={matchRoutine} placeholder="Routine name" />
      <button class="btn-primary" disabled={matching || !matchRoutine} onclick={handleMatch}>
        {matching ? "Matching..." : "Match Selected"}
      </button>
    </div>
  {/if}

  {#if loading}
    <p class="muted">Loading...</p>
  {:else if participants.length === 0}
    <p class="muted">No participants yet.</p>
  {:else}
    {#if assignsRoles && balanceLine}
      <span class="section-hint">Achieved balance (completed) — {balanceLine}</span>
    {/if}
    <table>
      <thead>
        <tr>
          <th></th>
          <th>Response ID</th>
          <th>Condition</th>
          <th>Role</th>
          <th>Progress</th>
          <th>Status</th>
          <th>Last Active</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each participants as p}
          <tr>
            <td>
              <input type="checkbox" checked={selectedIds.includes(p.id as string)} onchange={() => toggleSelect(p.id as string)} />
            </td>
            <td class="mono">{(p.responseId as string).slice(0, 8)}</td>
            <td>{p.condition ?? "—"}</td>
            <td>{p.role ?? 0}</td>
            <td>{p.progress}</td>
            <td>
              <span class="status-badge" class:online={p.isLoggedIn} class:completed={p.completion} class:withdrawn={p.withdraw}>
                {statusLabel(p)}
              </span>
            </td>
            <td class="mono">{p.lastLogTime ? new Date(p.lastLogTime as string).toLocaleString() : "—"}</td>
            <td>
              <button class="btn-danger-small" onclick={() => handleDelete(p.id as string)}>×</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .participants-tab { padding: 1.5rem; }
  h2 { font-size: 16px; font-weight: 600; margin: 0 0 1rem; }
  .section-hint { font-size: 12px; color: var(--gray-400); display: block; margin-bottom: 0.75rem; }
  .match-bar { display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem; background: var(--gray-50); border: 1px solid var(--gray-200); border-radius: var(--radius-sm); margin-bottom: 1rem; font-size: 14px; }
  .match-bar input { padding: 0.35rem 0.5rem; border: 1px solid var(--gray-200); border-radius: var(--radius-sm); font-size: 14px; }
  .btn-primary { background: var(--black); color: #fff; padding: 0.35rem 0.75rem; border: none; border-radius: var(--radius-sm); font-size: 13px; cursor: pointer; }
  .btn-primary:disabled { opacity: 0.5; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 0.5rem; border: 1px solid var(--gray-200); text-align: left; }
  th { background: var(--gray-50); font-weight: 500; }
  .mono { font-family: monospace; font-size: 12px; }
  .status-badge { font-size: 12px; padding: 2px 6px; border-radius: var(--radius-sm); }
  .status-badge.online { background: var(--success-dim); }
  .status-badge.completed { background: var(--gray-100); }
  .status-badge.withdrawn { background: var(--danger-dim); color: var(--danger); }
  .btn-danger-small { border: none; background: none; color: var(--danger); cursor: pointer; font-size: 14px; }
  .muted { color: var(--gray-400); font-size: 14px; }
</style>
