<script lang="ts">
  import type { RoutineConfig } from "ame-shared";
  import type { SequenceRow } from "ame-shared/progressSequence";
  import type { AssetSummary } from "$lib/api";
  import { parseContentCsv } from "$lib/admin/contentCsv";
  import { isLegacyCsv, parseWideCsv, writeWideCsv, starterCsv, csvFileName, WideFixedColumns } from "$lib/admin/wideContentCsv";
  import { ByteOrderMark } from "$lib/admin/csv";
  import { saveToDevice } from "$lib/upload/tusClient";

  let { rows, routines, assets, condition, nextProgress, experimentName, onimport }: {
    rows: SequenceRow[]; routines: RoutineConfig[]; assets: AssetSummary[];
    condition: string;
    /** The current condition's step count: where a starter CSV's rows begin. */
    nextProgress: number;
    experimentName: string; onimport: (rows: SequenceRow[]) => void;
  } = $props();

  let csvText = $state("");
  let error = $state("");
  let starterRoutine = $state("");

  /** The old JSON format still imports; everything else is the wide format. */
  function importText(raw: string) {
    error = "";
    const text = raw.startsWith(ByteOrderMark) ? raw.slice(ByteOrderMark.length) : raw;
    const parsed = isLegacyCsv(text) ? parseContentCsv(text) : parseWideCsv(text, routines, assets);
    if (parsed.error) { error = parsed.error; return; }
    if (parsed.rows.length === 0) { error = "Nothing to import. The CSV has no rows."; return; }
    onimport(parsed.rows.map((r) => ({ ...r, description: null })));
    csvText = "";
  }

  async function importFile(e: Event & { currentTarget: HTMLInputElement }) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    // Clear it so that the same file can be chosen again after a fix.
    input.value = "";
    if (!file) return;
    try {
      importText(await file.text());
    } catch {
      error = "The browser cannot read this file. Choose the file again.";
    }
  }

  /** The BOM makes Excel read the file as UTF-8. */
  const download = (text: string, suffix: string) =>
    saveToDevice(new Blob([`${ByteOrderMark}${text}`], { type: "text/csv;charset=utf-8" }), csvFileName(experimentName, suffix));

  function downloadStarter() {
    const routine = routines.find((r) => r.name === starterRoutine);
    if (routine) download(starterCsv(routine, condition, nextProgress, assets), `${routine.name}-starter`);
  }
</script>

<details class="advanced">
  <summary>CSV import and export</summary>
  <p class="caption">
    Columns: {WideFixedColumns.join(", ")}, then one column for each <code>element.param</code>.
    Import adds the rows to the sequence. A row with a progress that is in use joins that step.
    To add new steps, use progress numbers after the last step. Click Save sequence to keep the rows.
  </p>

  <div class="actions">
    <select aria-label="Starter CSV routine" bind:value={starterRoutine}>
      <option value="">Choose a routine…</option>
      {#each routines as r (r.name)}<option value={r.name}>{r.name}</option>{/each}
    </select>
    <button type="button" class="btn" disabled={!starterRoutine} onclick={downloadStarter}>Download starter CSV</button>
  </div>

  <div class="actions">
    <label class="btn">
      Upload CSV
      <input class="file" type="file" accept=".csv,text/csv" onchange={importFile} />
    </label>
    <button type="button" class="btn" disabled={rows.length === 0} onclick={() => download(writeWideCsv(rows, routines, assets), "sequence")}>
      Download CSV
    </button>
  </div>

  <textarea rows="5" bind:value={csvText} aria-label="CSV rows"></textarea>
  <div class="actions">
    <button type="button" class="btn" disabled={!csvText.trim()} onclick={() => importText(csvText)}>Import CSV</button>
    <button type="button" class="btn" disabled={rows.length === 0} onclick={() => (csvText = writeWideCsv(rows, routines, assets))}>Export CSV</button>
  </div>
  {#if error}<p class="error">{error}</p>{/if}
</details>

<style>
  .advanced { margin-top: 12px; font-size: 12px; }
  summary { cursor: pointer; color: var(--gray-500); }
  .caption { color: var(--gray-500); margin: 6px 0; }
  textarea { width: 100%; font-family: ui-monospace, monospace; font-size: 12px; box-sizing: border-box; margin-top: 6px; }
  .actions { display: flex; gap: 6px; margin-top: 6px; align-items: center; }
  .btn { padding: 4px 10px; border: 1px solid var(--black); background: var(--white); font: inherit; font-size: 12px; cursor: pointer; }
  .btn:disabled { opacity: 0.4; }
  label.btn { position: relative; }
  /* Visually hidden, still reachable by its label and by setInputFiles. */
  .file { position: absolute; width: 1px; height: 1px; opacity: 0; }
  .error { color: var(--danger); }
</style>
