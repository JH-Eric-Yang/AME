<script lang="ts">
  import { onMount } from "svelte";
  import * as api from "$lib/api";

  type Account = { id: string; email: string; name: string; role: string; status: string; createdAt: string };

  let accounts: Account[] = $state([]);
  let loading = $state(true);
  let filter = $state<string>("PENDING");
  let actionLoading = $state<string>("");

  onMount(() => loadAccounts());

  async function loadAccounts() {
    loading = true;
    try {
      accounts = await api.listAccounts(filter || undefined);
    } catch {
      // ignore
    } finally {
      loading = false;
    }
  }

  async function handleApprove(id: string) {
    actionLoading = id;
    try {
      await api.approveAccount(id);
      accounts = accounts.filter((a) => a.id !== id);
    } catch {
      // ignore
    } finally {
      actionLoading = "";
    }
  }

  async function handleReject(id: string) {
    if (!confirm("Reject and delete this account?")) return;
    actionLoading = id;
    try {
      await api.rejectAccount(id);
      accounts = accounts.filter((a) => a.id !== id);
    } catch {
      // ignore
    } finally {
      actionLoading = "";
    }
  }

  function setFilter(value: string) {
    filter = value;
    loadAccounts();
  }
</script>

<div class="page">
  <div class="page-header">
    <div>
      <h1>Accounts</h1>
      <p class="page-sub">Review and manage experimenter accounts.</p>
    </div>
  </div>

  <div class="filter-bar">
    <button class="filter-btn" class:active={filter === "PENDING"} onclick={() => setFilter("PENDING")}>Pending</button>
    <button class="filter-btn" class:active={filter === "APPROVED"} onclick={() => setFilter("APPROVED")}>Approved</button>
    <button class="filter-btn" class:active={filter === ""} onclick={() => setFilter("")}>All</button>
  </div>

  {#if loading}
    <div class="empty-state">
      <div class="loading-pulse"></div>
      <p>Loading accounts...</p>
    </div>
  {:else if accounts.length === 0}
    <div class="empty-state">
      <p>No {filter ? filter.toLowerCase() : ""} accounts.</p>
    </div>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Status</th>
          <th>Submitted</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each accounts as account}
          <tr>
            <td>{account.name}</td>
            <td class="mono">{account.email}</td>
            <td>
              <span class="status-badge" class:pending={account.status === "PENDING"} class:approved={account.status === "APPROVED"}>
                {account.status}
              </span>
            </td>
            <td class="mono">{new Date(account.createdAt).toLocaleDateString()}</td>
            <td class="actions">
              {#if account.status === "PENDING"}
                <button
                  class="btn-approve"
                  disabled={actionLoading === account.id}
                  onclick={() => handleApprove(account.id)}
                >Approve</button>
                <button
                  class="btn-reject"
                  disabled={actionLoading === account.id}
                  onclick={() => handleReject(account.id)}
                >Reject</button>
              {:else if account.role === "ADMIN"}
                <span class="admin-label">Admin</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .page-header { margin-bottom: 1.5rem; }
  h1 { font-family: var(--font-display); font-size: 22px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 0.25rem; }
  .page-sub { font-size: 13px; color: var(--gray-400); margin: 0; }

  .filter-bar { display: flex; gap: 0.25rem; margin-bottom: 1.5rem; }
  .filter-btn {
    font-family: var(--font-display); font-size: 12px; font-weight: 500; letter-spacing: 0.03em;
    padding: 0.4rem 0.75rem; background: none; border: 1px solid var(--gray-200);
    border-radius: var(--radius); color: var(--gray-500); cursor: pointer;
    transition: all var(--transition);
  }
  .filter-btn:hover { border-color: var(--black); color: var(--black); }
  .filter-btn.active { background: var(--black); color: var(--white); border-color: var(--black); }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 0.6rem 0.75rem; border: 1px solid var(--gray-200); text-align: left; }
  th { background: var(--gray-50); font-family: var(--font-display); font-size: 11px; font-weight: 500; letter-spacing: 0.05em; text-transform: uppercase; color: var(--gray-500); }
  .mono { font-family: monospace; font-size: 12px; }

  .status-badge { font-size: 11px; padding: 2px 6px; border-radius: var(--radius-sm); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 500; }
  .status-badge.pending { background: var(--accent-dim); color: var(--accent); }
  .status-badge.approved { background: var(--success-dim); color: var(--success); }

  .actions { display: flex; gap: 0.35rem; }
  .btn-approve {
    font-size: 12px; padding: 0.25rem 0.6rem; background: var(--black); color: var(--white);
    border: none; border-radius: var(--radius); cursor: pointer;
    transition: background var(--transition);
  }
  .btn-approve:hover { background: var(--success); }
  .btn-approve:disabled { opacity: 0.5; }
  .btn-reject {
    font-size: 12px; padding: 0.25rem 0.6rem; background: none; color: var(--gray-500);
    border: 1px solid var(--gray-200); border-radius: var(--radius); cursor: pointer;
    transition: all var(--transition);
  }
  .btn-reject:hover { border-color: var(--accent); color: var(--accent); }
  .btn-reject:disabled { opacity: 0.5; }
  .admin-label { font-size: 11px; color: var(--gray-400); font-style: italic; }

  .empty-state { display: flex; flex-direction: column; align-items: center; padding: 3rem; text-align: center; }
  .empty-state p { font-size: 14px; color: var(--gray-500); }
  .loading-pulse { width: 32px; height: 32px; border: 2px solid var(--gray-200); border-top-color: var(--black); border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
