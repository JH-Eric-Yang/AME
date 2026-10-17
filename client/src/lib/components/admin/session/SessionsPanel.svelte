<script lang="ts">
  import type { SessionSummary } from "ame-shared";
  import { pairingChips, seatRows, sessionHeading } from "$lib/admin/sessionRows";

  /** Must match sessionRows.ts — the row that says nobody is left to talk to. */
  const PartnerUnavailableLabel = "Partner unavailable";

  let { sessions }: { sessions: SessionSummary[] } = $props();
</script>

<section class="sessions">
  <h4>Sessions</h4>

  {#if sessions.length === 0}
    <p class="muted">No sessions yet. A session appears once every seat is filled.</p>
  {:else}
    {#each sessions as session (session.sessionId)}
      {@const heading = sessionHeading(session)}
      <article class="card">
        <header>
          <code>{heading.shortId}</code>
          <span class="muted">{heading.blockLabel}</span>
          <span>{heading.trialLabel}</span>
          <span class="spacer"></span>
          <span class="badge" class:closed={session.status === "CLOSED"}>
            {heading.statusLabel}
          </span>
        </header>

        <div class="body">
          <div class="label">CURRENT PAIRING</div>
          <div class="chips">
            {#each pairingChips(session) as chip (chip.groupIndex)}
              <span class="chip" class:solo={chip.solo}>{chip.text}</span>
            {:else}
              <span class="muted">Not started</span>
            {/each}
          </div>

          <table>
            <thead>
              <tr>
                <th>Seat</th>
                <th>Occupant</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Paired with</th>
              </tr>
            </thead>
            <tbody>
              {#each seatRows(session) as row (row.seat)}
                <tr class:dropped={row.status === "DROPPED"}>
                  <td>{row.label}</td>
                  <td><code>{row.occupant}</code></td>
                  <td>
                    <span class="badge" class:closed={row.status === "DROPPED"}>
                      {row.status === "DROPPED" ? "Dropped" : "Active"}
                    </span>
                  </td>
                  <td>{row.progressLabel}</td>
                  <td class:alert={row.partner === PartnerUnavailableLabel}>{row.partner}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </article>
    {/each}
  {/if}
</section>

<style>
  .sessions h4 {
    margin-bottom: 0.5rem;
    border-bottom: 1px solid var(--gray-200);
    padding-bottom: 0.25rem;
  }

  .card {
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-sm);
    overflow: hidden;
    margin-bottom: 1rem;
  }

  header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.6rem 0.75rem;
    background: var(--gray-50);
    border-bottom: 1px solid var(--gray-200);
    font-size: 12px;
  }

  .spacer {
    flex: 1;
  }

  .body {
    padding: 0.75rem;
  }

  .label {
    font-size: 11px;
    color: var(--gray-500);
    margin-bottom: 0.4rem;
    font-weight: 500;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 0.9rem;
  }

  .chip {
    font-size: 12px;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-sm);
    background: #fff;
  }

  .chip.solo {
    border-color: var(--danger);
    background: var(--danger-dim);
    color: var(--danger);
  }

  .badge {
    font-size: 12px;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    background: var(--success-dim);
  }

  .badge.closed {
    background: var(--danger-dim);
    color: var(--danger);
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

  tr.dropped code {
    color: var(--gray-400);
  }

  td.alert {
    color: var(--danger);
  }

  .muted {
    color: var(--gray-400);
    font-size: 13px;
  }

  code {
    font-size: 12px;
    background: var(--gray-50);
    padding: 1px 4px;
  }
</style>
