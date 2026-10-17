<script lang="ts">
  import { coverageMatrix } from "ame-shared/sessionDesign";
  import { buildCoverageGrid } from "$lib/admin/coverageGrid";

  interface Props {
    steps: number[][][];
    cohortSize: number;
  }

  let { steps, cohortSize }: Props = $props();

  const grid = $derived(buildCoverageGrid(coverageMatrix(steps, cohortSize), cohortSize));
</script>

<div class="coverage">
  <table>
    <thead>
      <tr>
        <th class="corner"></th>
        {#each grid.heads as head}
          <th>{head}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each grid.rows as row}
        <tr>
          <th class="row-label">{row.label}</th>
          {#each row.cells as cell}
            <td class="cell {cell.state}" title={cell.title}>{cell.text}</td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>

  <div class="footer">
    <div class="count">{grid.met} of {grid.total} pairs covered</div>
    <div class="note">{grid.repeats} repeats</div>
    <div class="note">{grid.never} never meet</div>
    <div class="spacer"></div>
    <div class="legend">
      <span class="swatch once"></span>
      <span>meets, cell shows the trial</span>
      <span class="swatch never"></span>
      <span>never meets</span>
    </div>
  </div>

  <p class="explainer">
    A blank cell above the diagonal means those two participants never share a trial. With a
    full round-robin every cell is filled exactly once &mdash; which is what makes the schedule
    checkable rather than merely asserted.
  </p>
</div>

<style>
  .coverage { padding: 1.25rem; overflow: auto; }
  table { border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid var(--gray-200); }
  thead th { padding: 0.4rem 0; background: var(--gray-50); font-weight: 500; font-size: 11px; color: var(--gray-600); text-align: center; width: 46px; }
  thead th.corner { width: auto; }
  .row-label { padding: 0.4rem 0.5rem; background: var(--gray-50); font-weight: 500; font-size: 11px; color: var(--gray-600); white-space: nowrap; text-align: left; }
  .cell { padding: 0.4rem 0; text-align: center; font-size: 11px; font-family: monospace; color: var(--black); background: #fff; }
  .cell.unused { background: var(--white); }
  .cell.once { background: rgba(255, 61, 0, 0.08); }
  .cell.repeat { background: rgba(255, 61, 0, 0.22); }
  .footer { display: flex; align-items: center; gap: 1.25rem; margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid var(--gray-200); }
  .count { font-size: 13px; font-weight: 500; }
  .note { font-size: 12px; color: var(--gray-500); }
  .spacer { flex: 1; }
  .legend { display: flex; align-items: center; gap: 0.5rem; font-size: 11px; color: var(--gray-500); }
  .swatch { display: inline-block; width: 14px; height: 14px; border: 1px solid var(--gray-200); }
  .swatch.once { background: rgba(255, 61, 0, 0.08); }
  .swatch.never { background: #fff; margin-left: 0.5rem; }
  .explainer { margin: 1rem 0 0; font-size: 12px; color: var(--gray-600); max-width: 640px; line-height: 1.6; }
</style>
