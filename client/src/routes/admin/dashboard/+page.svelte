<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import * as api from "$lib/api";
  import { participantLink } from "$lib/admin/participantLink";
  import CopyLinkButton from "$lib/components/admin/CopyLinkButton.svelte";

  let experiments: Record<string, unknown>[] = $state([]);
  let loading = $state(true);
  let error = $state("");

  onMount(async () => {
    try {
      experiments = (await api.listExperiments()) as Record<string, unknown>[];
    } catch (e) {
      error = e instanceof api.ApiError ? e.message : "Failed to load experiments";
    } finally {
      loading = false;
    }
  });

  async function handleToggleVisibility(id: string) {
    try {
      const result = await api.toggleVisibility(id);
      experiments = experiments.map((exp) =>
        exp.id === id ? { ...exp, visible: result.visible } : exp,
      );
    } catch {
      // ignore
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this experiment?")) return;
    try {
      await api.deleteExperiment(id);
      experiments = experiments.filter((exp) => exp.id !== id);
    } catch {
      // ignore
    }
  }
</script>

<div class="page">
  <div class="page-header">
    <div>
      <h1>Experiments</h1>
      <p class="page-sub">Manage your experiment designs and monitor participants.</p>
    </div>
    <a href="/admin/dashboard/experiment/new" class="new-btn">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <span>New Experiment</span>
    </a>
  </div>

  {#if loading}
    <div class="empty-state">
      <div class="loading-pulse"></div>
      <p>Loading experiments...</p>
    </div>
  {:else if error}
    <div class="error-banner">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.2"/><path d="M7 4v3M7 9v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      <span>{error}</span>
    </div>
  {:else if experiments.length === 0}
    <div class="empty-state">
      <div class="empty-icon">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <rect x="4" y="6" width="32" height="28" rx="2" stroke="var(--gray-300)" stroke-width="1.5"/>
          <path d="M4 14h32" stroke="var(--gray-300)" stroke-width="1.5"/>
          <circle cx="10" cy="10" r="1.5" fill="var(--gray-300)"/>
          <circle cx="15" cy="10" r="1.5" fill="var(--gray-300)"/>
          <circle cx="20" cy="10" r="1.5" fill="var(--gray-300)"/>
        </svg>
      </div>
      <p>No experiments yet</p>
      <span class="empty-hint">Create your first experiment to get started.</span>
    </div>
  {:else}
    <div class="experiment-grid">
      {#each experiments as exp, i}
        <a href="/admin/dashboard/experiment/{exp.id}" class="experiment-card" style="animation-delay: {i * 50}ms">
          <div class="card-top">
            <div class="card-status" class:active={exp.visible}>
              <span class="status-dot"></span>
              {exp.visible ? "Live" : "Draft"}
            </div>
            <div class="card-actions">
              <CopyLinkButton text={participantLink($page.url.origin, exp.id as string)} compact />
              <button
                class="action-btn"
                title={exp.visible ? "Hide" : "Show"}
                onclick={(e) => { e.preventDefault(); handleToggleVisibility(exp.id as string); }}
              >
                {exp.visible ? "Hide" : "Show"}
              </button>
              <button
                class="action-btn danger"
                title="Delete"
                onclick={(e) => { e.preventDefault(); handleDelete(exp.id as string); }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M11 4l-.5 8a1 1 0 01-1 1h-5a1 1 0 01-1-1L3 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
          </div>

          <h2 class="card-title">{exp.name}</h2>

          {#if exp.description}
            <p class="card-desc">{(exp.description as string).slice(0, 100)}</p>
          {/if}

          <div class="card-stats">
            <div class="stat">
              <span class="stat-val">{(exp.conditions as string[])?.length ?? 0}</span>
              <span class="stat-lbl">Conditions</span>
            </div>
            <div class="stat">
              <span class="stat-val">{(exp.routines as unknown[])?.length ?? 0}</span>
              <span class="stat-lbl">Routines</span>
            </div>
            <div class="stat">
              <span class="stat-val">{(exp._count as Record<string, number>)?.participants ?? 0}</span>
              <span class="stat-lbl">Participants</span>
            </div>
          </div>

          <div class="card-footer">
            <span class="open-link">
              Open
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M1 6h10M7 2l4 4-4 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>

<style>
  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 2rem;
  }

  h1 {
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin: 0 0 0.25rem;
  }

  .page-sub {
    font-size: 13px;
    color: var(--gray-400);
    margin: 0;
  }

  .new-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.6rem 1.25rem;
    background: var(--black);
    color: var(--white);
    font-size: 14px;
    font-weight: 600;
    border-radius: var(--radius);
    transition: background var(--transition), transform var(--transition);
    white-space: nowrap;
  }
  .new-btn:hover {
    background: var(--accent);
    transform: translateY(-1px);
  }

  /* Grid */
  .experiment-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1rem;
  }

  .experiment-card {
    background: var(--white);
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    padding: 1.25rem 1.5rem;
    text-decoration: none;
    color: inherit;
    display: flex;
    flex-direction: column;
    transition: border-color var(--transition), box-shadow var(--transition), transform var(--transition);
    animation: cardIn 400ms ease both;
  }
  .experiment-card:hover {
    border-color: var(--gray-300);
    box-shadow: 0 2px 12px rgba(0,0,0,0.04);
    transform: translateY(-2px);
  }
  @keyframes cardIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }

  .card-status {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-family: var(--font-display);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--gray-400);
  }
  .card-status.active { color: var(--accent); }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--gray-300);
  }
  .card-status.active .status-dot {
    background: var(--accent);
    box-shadow: 0 0 6px rgba(255, 61, 0, 0.4);
  }

  .card-actions {
    display: flex;
    gap: 0.35rem;
    opacity: 0;
    transition: opacity var(--transition);
  }
  .experiment-card:hover .card-actions,
  .experiment-card:focus-within .card-actions { opacity: 1; }

  .action-btn {
    font-family: var(--font-display);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.05em;
    padding: 0.2rem 0.5rem;
    background: none;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    color: var(--gray-500);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    transition: all var(--transition);
  }
  .action-btn:hover { border-color: var(--black); color: var(--black); }
  .action-btn.danger:hover { border-color: var(--accent); color: var(--accent); }

  .card-title {
    font-size: 17px;
    font-weight: 700;
    letter-spacing: -0.01em;
    margin: 0 0 0.25rem;
  }

  .card-desc {
    font-size: 13px;
    color: var(--gray-500);
    margin: 0 0 0.75rem;
    line-height: 1.5;
  }

  .card-stats {
    display: flex;
    gap: 1.5rem;
    margin-top: auto;
    padding-top: 0.75rem;
    border-top: 1px solid var(--gray-100);
  }

  .stat {
    display: flex;
    flex-direction: column;
  }
  .stat-val {
    font-family: var(--font-display);
    font-size: 16px;
    font-weight: 600;
    color: var(--black);
  }
  .stat-lbl {
    font-size: 10px;
    color: var(--gray-400);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .card-footer {
    margin-top: 0.75rem;
  }

  .open-link {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.05em;
    color: var(--gray-400);
    transition: color var(--transition);
  }
  .experiment-card:hover .open-link { color: var(--accent); }
  .open-link svg { transition: transform var(--transition); }
  .experiment-card:hover .open-link svg { transform: translateX(3px); }

  /* Empty state */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem 2rem;
    text-align: center;
  }
  .empty-state p {
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 500;
    color: var(--gray-500);
    margin: 1rem 0 0.25rem;
  }
  .empty-hint {
    font-size: 13px;
    color: var(--gray-400);
  }
  .empty-icon { color: var(--gray-300); }

  .loading-pulse {
    width: 32px;
    height: 32px;
    border: 2px solid var(--gray-200);
    border-top-color: var(--black);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .error-banner {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.65rem 0.75rem;
    background: var(--accent-dim);
    border-left: 3px solid var(--accent);
    color: var(--accent);
    font-size: 13px;
    border-radius: 0 var(--radius) var(--radius) 0;
  }
</style>
