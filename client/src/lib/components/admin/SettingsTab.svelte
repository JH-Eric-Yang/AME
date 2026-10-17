<script lang="ts">
  import { experiment } from "$lib/stores/experiment";
  import { downloadExport, importExperimentJson } from "$lib/api";

  let importStatus = $state<string | null>(null);

  async function handleImportJson(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      importStatus = "Importing...";
      const text = await file.text();
      const data = JSON.parse(text);
      const result = await importExperimentJson(data);
      window.location.href = `/admin/dashboard/experiment/${result.id}`;
    } catch (err) {
      importStatus = `Import failed: ${err instanceof Error ? err.message : "Unknown error"}`;
    }
  }

  let conditionsText = $derived($experiment.conditions.join(", "));

  function updateConditions(text: string) {
    const conditions = text.split(",").map((c) => c.trim()).filter(Boolean);
    experiment.setField("conditions", conditions);
  }

  function parsePropertyValue(text: string): unknown {
    if (text === "true") return true;
    if (text === "false") return false;
    // Comma-separated values → array (e.g., "gesturer, guesser" → ["gesturer", "guesser"])
    if (text.includes(",")) {
      return text.split(",").map((s) => {
        const trimmed = s.trim();
        if (trimmed === "true") return true;
        if (trimmed === "false") return false;
        const num = Number(trimmed);
        return isNaN(num) ? trimmed : num;
      });
    }
    const num = Number(text);
    return isNaN(num) ? text : num;
  }

  function formatPropertyValue(value: unknown): string {
    if (Array.isArray(value)) return value.join(", ");
    return String(value ?? "");
  }

  let initPropEntries = $derived(Object.entries($experiment.initialProperties));

  function setInitialProp(key: string, value: unknown) {
    experiment.setField("initialProperties", { ...$experiment.initialProperties, [key]: value });
  }

  function removeInitialProp(key: string) {
    const { [key]: _, ...rest } = $experiment.initialProperties;
    experiment.setField("initialProperties", rest);
  }

  function renameInitialProp(oldKey: string, newKey: string) {
    if (oldKey === newKey || !newKey) return;
    const props = { ...$experiment.initialProperties };
    const value = props[oldKey];
    delete props[oldKey];
    props[newKey] = value;
    experiment.setField("initialProperties", props);
  }

  let newInitPropKey = $state("");

  function getConditionProps(condition: string): Record<string, unknown> {
    return $experiment.conditionProperties[condition] ?? {};
  }

  function setConditionProp(condition: string, key: string, value: unknown) {
    const condProps = { ...$experiment.conditionProperties };
    condProps[condition] = { ...getConditionProps(condition), [key]: value };
    experiment.setField("conditionProperties", condProps);
  }

  function removeConditionProp(condition: string, key: string) {
    const condProps = { ...$experiment.conditionProperties };
    const { [key]: _, ...rest } = getConditionProps(condition);
    condProps[condition] = rest;
    experiment.setField("conditionProperties", condProps);
  }

  function renameConditionProp(condition: string, oldKey: string, newKey: string) {
    if (oldKey === newKey || !newKey) return;
    const condProps = { ...$experiment.conditionProperties };
    const props = { ...getConditionProps(condition) };
    const value = props[oldKey];
    delete props[oldKey];
    props[newKey] = value;
    condProps[condition] = props;
    experiment.setField("conditionProperties", condProps);
  }

  let newCondPropKeys: Record<string, string> = $state({});

  import type { RandomizationConfig, RandomizationRange, RandomizationMethod } from "ame-shared";

  // Randomization helpers
  let selectedRandomizationCondition = $state("Basic");

  function getConditionsForRandomization(): string[] {
    const conditions = $experiment.conditions;
    return conditions.length > 0 ? conditions : ["Basic"];
  }

  function getRangesForCondition(condition: string): RandomizationRange[] {
    const config = $experiment.randomizationConfig as RandomizationConfig | null;
    return config?.[condition] ?? [];
  }

  function updateRangesForCondition(condition: string, ranges: RandomizationRange[]) {
    const config = ($experiment.randomizationConfig as RandomizationConfig | null) ?? {};
    experiment.setField("randomizationConfig", { ...config, [condition]: ranges });
  }

  function addRange(condition: string) {
    const ranges = getRangesForCondition(condition);
    updateRangesForCondition(condition, [
      ...ranges,
      { fromTrial: 0, toTrial: 0, method: "shuffle" as RandomizationMethod },
    ]);
  }

  function removeRange(condition: string, index: number) {
    const ranges = getRangesForCondition(condition);
    updateRangesForCondition(condition, ranges.filter((_, i) => i !== index));
  }

  function updateRange(condition: string, index: number, field: string, value: unknown) {
    const ranges = getRangesForCondition(condition);
    const updated = ranges.map((r, i) => (i === index ? { ...r, [field]: value } : r));
    updateRangesForCondition(condition, updated);
  }
</script>

<div class="settings">
  <h2>Experiment Settings</h2>

  <section>
    <h3>Basic Information</h3>
    <label>
      <span>Name</span>
      <input type="text" value={$experiment.name} oninput={(e) => experiment.setField("name", e.currentTarget.value)} />
    </label>
    <label>
      <span>Description</span>
      <textarea rows="3" value={$experiment.description} oninput={(e) => experiment.setField("description", e.currentTarget.value)}></textarea>
    </label>
    <label class="checkbox">
      <input type="checkbox" checked={$experiment.visible} onchange={(e) => experiment.setField("visible", e.currentTarget.checked)} />
      <span>Visible to participants</span>
    </label>
    <label class="checkbox">
      <input type="checkbox" checked={$experiment.allowNew} onchange={(e) => experiment.setField("allowNew", e.currentTarget.checked)} />
      <span>Allow new participants</span>
    </label>
  </section>

  <section>
    <h3>Capabilities</h3>
    <label class="checkbox">
      <input type="checkbox" checked={$experiment.avCollection} onchange={(e) => experiment.setField("avCollection", e.currentTarget.checked)} />
      <span>Audio/Video Collection</span>
    </label>
    <label class="checkbox">
      <input type="checkbox" checked={$experiment.bodyDetection} onchange={(e) => experiment.setField("bodyDetection", e.currentTarget.checked)} />
      <span>Body Detection</span>
    </label>
    <label class="checkbox">
      <input type="checkbox" checked={$experiment.videoChat} onchange={(e) => experiment.setField("videoChat", e.currentTarget.checked)} />
      <span>Video Chat</span>
    </label>
    <label>
      <span>Supplementary Device</span>
      <select value={$experiment.supplementaryDevice} onchange={(e) => experiment.setField("supplementaryDevice", e.currentTarget.value)}>
        <option value="NONE">None</option>
        <option value="CAMERA">Camera</option>
        <option value="CONTROLLER">Controller</option>
      </select>
    </label>
  </section>

  <section>
    <h3>Timing</h3>
    <label>
      <span>Active Time (minutes)</span>
      <input type="number" value={$experiment.activeTime} oninput={(e) => experiment.setField("activeTime", parseInt(e.currentTarget.value))} min="1" />
    </label>
    <label>
      <span>Roll-Back Time (minutes)</span>
      <input type="number" value={$experiment.rollBackTime} oninput={(e) => experiment.setField("rollBackTime", parseInt(e.currentTarget.value))} min="1" />
    </label>
  </section>

  <section>
    <h3>Session & Conditions</h3>
    <label>
      <span>Participants Per Session</span>
      <input type="number" value={$experiment.participantsPerSession} oninput={(e) => experiment.setField("participantsPerSession", parseInt(e.currentTarget.value))} min="1" max="10" />
    </label>
    <label>
      <span>Participant ID URL parameter</span>
      <input
        type="text"
        value={$experiment.participantIdParam ?? ""}
        oninput={(e) => experiment.setField("participantIdParam", e.currentTarget.value.trim() || null)}
        placeholder="PROLIFIC_PID"
      />
      <small class="field-hint">
        {#if $experiment.participantIdParam}
          Participants arriving at
          <code>?{$experiment.participantIdParam}=…</code>
          have that value recorded and are resumed if they return. Leave blank to disable.
        {:else}
          Name of the query parameter carrying the recruitment platform's participant id
          (e.g. <code>PROLIFIC_PID</code>). Leave blank to disable.
        {/if}
      </small>
    </label>
    <label>
      <span>Conditions (comma-separated)</span>
      <input type="text" value={conditionsText} oninput={(e) => updateConditions(e.currentTarget.value)} placeholder="Control, Treatment A, Treatment B" />
    </label>
    <label class="checkbox">
      <input type="checkbox" checked={$experiment.randomization} onchange={(e) => experiment.setField("randomization", e.currentTarget.checked)} />
      <span>Randomize routine order</span>
    </label>
    <label>
      <span>Default Matching Strategy</span>
      <select value={$experiment.matchingStrategy} onchange={(e) => experiment.setField("matchingStrategy", e.currentTarget.value)}>
        <option value="FIFO">FIFO</option>
        <option value="PROPERTY">Property-Based</option>
        <option value="MANUAL">Manual</option>
      </select>
    </label>
  </section>

  {#if $experiment.randomization}
    <fieldset>
      <legend>Randomization</legend>

      <!-- Condition tabs -->
      <div class="condition-tabs">
        {#each getConditionsForRandomization() as cond}
          <button
            class="condition-tab"
            class:active={selectedRandomizationCondition === cond}
            onclick={() => (selectedRandomizationCondition = cond)}
          >
            {cond}
          </button>
        {/each}
      </div>

      <!-- Ranges for selected condition -->
      {#each getRangesForCondition(selectedRandomizationCondition) as range, i}
        <div class="range-card">
          <div class="range-header">
            <span class="range-label">Range {i + 1}</span>
            <button
              class="range-remove"
              onclick={() => removeRange(selectedRandomizationCondition, i)}
            >
              Remove
            </button>
          </div>
          <div class="range-fields">
            <label>
              <span>From Trial</span>
              <input
                type="number"
                min="0"
                value={range.fromTrial}
                onchange={(e) =>
                  updateRange(selectedRandomizationCondition, i, "fromTrial", parseInt(e.currentTarget.value) || 0)
                }
              />
            </label>
            <label>
              <span>To Trial</span>
              <input
                type="number"
                min="0"
                value={range.toTrial}
                onchange={(e) =>
                  updateRange(selectedRandomizationCondition, i, "toTrial", parseInt(e.currentTarget.value) || 0)
                }
              />
            </label>
            <label>
              <span>Method</span>
              <select
                value={range.method}
                onchange={(e) =>
                  updateRange(selectedRandomizationCondition, i, "method", e.currentTarget.value)
                }
              >
                <option value="shuffle">Shuffle</option>
                <option value="latin-square">Latin Square</option>
                <option value="block">Block</option>
              </select>
            </label>
            <label class:disabled={range.method !== "block"}>
              <span>Block Size</span>
              <input
                type="number"
                min="1"
                value={range.blockSize ?? ""}
                disabled={range.method !== "block"}
                onchange={(e) =>
                  updateRange(selectedRandomizationCondition, i, "blockSize", parseInt(e.currentTarget.value) || 1)
                }
              />
            </label>
          </div>
        </div>
      {/each}

      <button class="add-range" onclick={() => addRange(selectedRandomizationCondition)}>
        + Add Randomization Range
      </button>
    </fieldset>
  {/if}

  <section>
    <h3>Initial Properties</h3>
    <span class="section-hint">Default properties assigned to every participant on join.
      <span class="info-tip">?
        <span class="info-tooltip">Add one property per row. Values are auto-detected as numbers, booleans, or strings.<br/><br/><b>Multiple values:</b> Use commas to set a list, e.g. "gesturer, guesser" becomes an array ["gesturer", "guesser"].<br/><br/>Properties can be updated later by elements with "Sets Property" (e.g., a survey response determines the participant's role).<br/><br/>Properties drive matching slot filters and element visibility.</span>
      </span>
    </span>
    {#each initPropEntries as [key, value], idx}
      <div class="prop-row">
        <input
          type="text"
          class="prop-key"
          value={key}
          placeholder="key"
          onblur={(e) => renameInitialProp(key, e.currentTarget.value.trim())}
        />
        <input
          type="text"
          class="prop-value"
          value={formatPropertyValue(value)}
          placeholder="value"
          oninput={(e) => setInitialProp(key, parsePropertyValue(e.currentTarget.value))}
        />
        <button class="prop-remove" onclick={() => removeInitialProp(key)}>&times;</button>
      </div>
    {/each}
    <div class="prop-add-row">
      <input type="text" bind:value={newInitPropKey} placeholder="New property name" class="prop-key" />
      <button
        class="prop-add-btn"
        onclick={() => { if (newInitPropKey.trim()) { setInitialProp(newInitPropKey.trim(), ""); newInitPropKey = ""; } }}
      >+ Add</button>
    </div>
  </section>

  {#if $experiment.conditions.length > 0}
    <section>
      <h3>Condition Properties</h3>
      <span class="section-hint">Per-condition overrides. These values override initial properties for participants in each condition.</span>
      {#each $experiment.conditions as condition}
        <fieldset class="condition-fieldset">
          <legend>{condition}</legend>
          {#each Object.entries(getConditionProps(condition)) as [key, value]}
            <div class="prop-row">
              <input
                type="text"
                class="prop-key"
                value={key}
                placeholder="key"
                onblur={(e) => renameConditionProp(condition, key, e.currentTarget.value.trim())}
              />
              <input
                type="text"
                class="prop-value"
                value={formatPropertyValue(value)}
                placeholder="value"
                oninput={(e) => setConditionProp(condition, key, parsePropertyValue(e.currentTarget.value))}
              />
              <button class="prop-remove" onclick={() => removeConditionProp(condition, key)}>&times;</button>
            </div>
          {/each}
          <div class="prop-add-row">
            <input type="text" value={newCondPropKeys[condition] ?? ""} oninput={(e) => (newCondPropKeys = { ...newCondPropKeys, [condition]: e.currentTarget.value })} placeholder="New property name" class="prop-key" />
            <button
              class="prop-add-btn"
              onclick={() => { const k = (newCondPropKeys[condition] ?? "").trim(); if (k) { setConditionProp(condition, k, ""); newCondPropKeys = { ...newCondPropKeys, [condition]: "" }; } }}
            >+ Add</button>
          </div>
        </fieldset>
      {/each}
    </section>
  {/if}

  <section>
    <h3>Export & Import</h3>
    <span class="section-hint">Export this experiment as JSON (config + content rows), or import from a previously exported file.</span>
    <div class="export-actions">
      <button type="button" class="export-btn" onclick={() => downloadExport($experiment.id, "json")}>Export as JSON</button>
      <label class="export-btn import-label">
        Import from JSON
        <input type="file" accept=".json" hidden onchange={handleImportJson} />
      </label>
    </div>
    {#if importStatus}
      <p class="import-status">{importStatus}</p>
    {/if}
  </section>
</div>

<style>
  .settings { padding: 1.5rem; max-width: 600px; }
  h2 { font-size: 16px; font-weight: 600; margin: 0 0 1.5rem; }
  h3 { font-size: 14px; font-weight: 600; margin: 0 0 0.75rem; color: var(--gray-500); }
  section { margin-bottom: 2rem; }
  label { display: block; margin-bottom: 0.75rem; }
  label span { display: block; font-size: 14px; font-weight: 500; margin-bottom: 0.25rem; }
  label.checkbox { display: flex; align-items: center; gap: 0.5rem; }
  label.checkbox span { margin-bottom: 0; }
  input[type="text"], input[type="number"], textarea, select {
    width: 100%; padding: 0.5rem; border: 1px solid var(--gray-200); border-radius: var(--radius-sm); font-size: 14px; box-sizing: border-box;
  }
  input:focus, textarea:focus, select:focus { outline: none; border-color: var(--black); }
  .section-hint { font-size: 12px; color: var(--gray-400); display: block; margin-bottom: 0.75rem; }
  .prop-row { display: flex; gap: 0.35rem; align-items: center; margin-bottom: 0.35rem; }
  .prop-key { flex: 1; padding: 0.4rem 0.5rem; border: 1px solid var(--gray-200); border-radius: var(--radius-sm); font-size: 13px; }
  .prop-value { flex: 1; padding: 0.4rem 0.5rem; border: 1px solid var(--gray-200); border-radius: var(--radius-sm); font-size: 13px; }
  .prop-remove { border: none; background: none; color: var(--danger); cursor: pointer; font-size: 16px; padding: 0 0.25rem; line-height: 1; flex-shrink: 0; }
  .prop-add-row { display: flex; gap: 0.35rem; align-items: center; margin-top: 0.25rem; }
  .prop-add-btn { font-size: 12px; padding: 0.35rem 0.6rem; border: 1px solid var(--black); border-radius: var(--radius-sm); background: #fff; cursor: pointer; white-space: nowrap; }
  .prop-add-btn:hover { background: var(--gray-50); }
  .condition-fieldset { border: 1px solid var(--gray-200); border-radius: var(--radius-sm); padding: 0.75rem; margin-bottom: 0.75rem; }
  .condition-fieldset legend { font-size: 13px; font-weight: 500; padding: 0 0.25rem; }
  .info-tip { display: inline-block; width: 14px; height: 14px; line-height: 14px; text-align: center; border-radius: 50%; background: var(--gray-200); color: var(--gray-500); font-size: 10px; font-weight: 600; cursor: help; vertical-align: middle; margin-left: 0.25rem; position: relative; }
  .info-tooltip { display: none; position: absolute; left: 50%; transform: translateX(-50%); top: 1.5rem; width: 260px; padding: 0.6rem 0.75rem; background: var(--gray-700); color: #fff; font-size: 11px; font-weight: 400; line-height: 1.5; border-radius: var(--radius-sm); z-index: 10; white-space: normal; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
  .info-tip:hover .info-tooltip { display: block; }
  .condition-tabs {
    display: flex;
    gap: 0;
    margin-bottom: 16px;
    border-bottom: 2px solid var(--gray-200);
  }
  .condition-tab {
    padding: 6px 16px;
    background: transparent;
    border: 1px solid var(--gray-200);
    border-bottom: none;
    color: var(--gray-500);
    cursor: pointer;
    font-size: 13px;
  }
  .condition-tab.active {
    background: var(--black);
    color: var(--white);
    font-weight: 600;
  }
  .range-card {
    border: 1px solid var(--gray-200);
    border-radius: 6px;
    padding: 12px;
    margin-bottom: 8px;
  }
  .range-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .range-label {
    font-weight: 600;
    font-size: 13px;
  }
  .range-remove {
    font-size: 11px;
    color: var(--danger);
    background: none;
    border: 1px solid var(--danger);
    border-radius: var(--radius-sm);
    padding: 2px 8px;
    cursor: pointer;
  }
  .range-fields {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr;
    gap: 8px;
  }
  .range-fields label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .range-fields label span {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--gray-500);
  }
  .range-fields label.disabled {
    opacity: 0.3;
  }
  .add-range {
    width: 100%;
    padding: 10px;
    border: 1px dashed var(--gray-300);
    border-radius: 6px;
    background: transparent;
    color: var(--gray-500);
    cursor: pointer;
    font-size: 13px;
  }
  .add-range:hover {
    border-color: var(--gray-500);
  }
  .export-actions { display: flex; gap: 0.5rem; }
  .export-btn {
    display: inline-block; padding: 0.5rem 1rem; border: 1px solid var(--black);
    border-radius: var(--radius-sm); font-size: 13px; background: #fff; color: var(--black);
    text-decoration: none; cursor: pointer; text-align: center;
  }
  .export-btn:hover { background: var(--gray-50); }
  .import-label { position: relative; }
  .import-status { font-size: 12px; color: var(--gray-500); margin-top: 0.5rem; }
  .field-hint {
    display: block;
    margin-top: 0.25rem;
    font-size: 12px;
    color: var(--gray-500);
  }
  .field-hint code {
    background: var(--gray-50);
    padding: 0 0.25rem;
    border-radius: var(--radius-sm);
  }
</style>
