<script lang="ts">
  import type { RoutineLayout, GridRow } from "ame-shared";

  interface Props {
    layout: RoutineLayout;
    onaddrow: () => void;
    onremoverow: (rowIndex: number) => void;
    onupdaterow: (rowIndex: number, row: Partial<GridRow>) => void;
  }

  let { layout, onaddrow, onremoverow, onupdaterow }: Props = $props();

  function parseColumnSpans(input: string): { span: number }[] | null {
    const parts = input.split(":").map((s) => parseInt(s.trim(), 10));
    if (parts.some(isNaN) || parts.some((n) => n < 1 || n > 12)) return null;
    if (parts.reduce((a, b) => a + b, 0) > 12) return null;
    return parts.map((span) => ({ span }));
  }

  function formatColumns(row: GridRow): string {
    return row.columns.map((c) => c.span).join(":");
  }

  function handleColumnsChange(rowIndex: number, value: string) {
    const columns = parseColumnSpans(value);
    if (columns) onupdaterow(rowIndex, { columns });
  }
</script>

<div class="toolbar">
  <div class="toolbar-left">
    <span class="toolbar-label">Layout</span>
    <button class="toolbar-btn" onclick={onaddrow}>+ Row</button>
  </div>

  <div class="row-configs">
    {#each layout.rows as row, ri}
      <div class="row-config">
        <span class="row-num">Row {ri + 1}</span>
        <span class="col-label" aria-hidden="true">Columns</span>
        <input
          type="text"
          class="col-input"
          aria-label="Row {ri + 1} column widths"
          value={formatColumns(row)}
          onchange={(e) => handleColumnsChange(ri, e.currentTarget.value)}
          title="Type the column widths out of 12, for example 6:6 or 4:8"
          placeholder="12"
        />
        <select
          class="justify-select"
          value={row.justify ?? "start"}
          onchange={(e) => onupdaterow(ri, { justify: e.currentTarget.value as GridRow["justify"] })}
        >
          <option value="start">Left</option>
          <option value="center">Center</option>
          <option value="end">Right</option>
          <option value="between">Space Between</option>
          <option value="around">Space Around</option>
        </select>
        {#if layout.rows.length > 1}
          <button class="remove-btn" onclick={() => onremoverow(ri)} title="Remove row">&times;</button>
        {/if}
      </div>
    {/each}
    <span class="col-hint">Column widths are out of 12. Type 6:6 for two equal columns, or 4:8 for a narrow and a wide column.</span>
  </div>
</div>

<style>
  .toolbar { display: flex; align-items: flex-start; gap: 1rem; padding: 0.5rem 1rem; border-bottom: 1px solid var(--gray-200); background: var(--white); }
  .toolbar-left { display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; }
  .toolbar-label { font-size: 12px; font-weight: 600; color: var(--gray-600); }
  .toolbar-btn { font-size: 12px; padding: 0.2rem 0.5rem; border: 1px solid var(--gray-200); border-radius: var(--radius); background: var(--white); cursor: pointer; }
  .toolbar-btn:hover { border-color: var(--black); }
  .row-configs { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .row-config { display: flex; align-items: center; gap: 0.25rem; padding: 0.15rem 0.35rem; border: 1px solid var(--gray-200); border-radius: var(--radius); background: var(--white); }
  .row-num { font-size: 10px; font-weight: 600; color: var(--gray-400); white-space: nowrap; }
  .col-label { font-size: 10px; color: var(--gray-500); }
  .col-hint { flex-basis: 100%; font-size: 10px; color: var(--gray-400); }
  .col-input { width: 60px; font-size: 11px; padding: 0.15rem 0.25rem; border: 1px solid var(--gray-200); border-radius: var(--radius); font-family: var(--font-display); }
  .col-input:focus { outline: none; border-color: var(--black); }
  .justify-select { font-size: 11px; padding: 0.15rem; border: 1px solid var(--gray-200); border-radius: var(--radius); }
  .remove-btn { font-size: 14px; border: none; background: none; color: var(--danger); cursor: pointer; padding: 0 0.25rem; }
</style>
