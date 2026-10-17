<script lang="ts">
  interface Props {
    surveyJson: Record<string, unknown> | null;
    onchange: (json: Record<string, unknown>) => void;
  }

  let { surveyJson, onchange }: Props = $props();

  let jsonText = $state(surveyJson ? JSON.stringify(surveyJson, null, 2) : "");
  let error = $state("");
  let fileInput: HTMLInputElement | undefined = $state();

  // Sync external changes to text
  $effect(() => {
    const newText = surveyJson ? JSON.stringify(surveyJson, null, 2) : "";
    if (newText !== jsonText) {
      jsonText = newText;
      error = "";
    }
  });

  function handleInput(e: Event) {
    jsonText = (e.target as HTMLTextAreaElement).value;
    error = "";
  }

  function applyJson() {
    if (!jsonText.trim()) {
      onchange({});
      error = "";
      return;
    }
    try {
      const parsed = JSON.parse(jsonText);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        error = "JSON must be an object (not an array or primitive)";
        return;
      }
      onchange(parsed);
      error = "";
    } catch (e) {
      error = `Invalid JSON: ${(e as Error).message}`;
    }
  }

  function handleValidate() {
    if (!jsonText.trim()) {
      error = "";
      return;
    }
    try {
      const parsed = JSON.parse(jsonText);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        error = "JSON must be an object (not an array or primitive)";
        return;
      }
      if (!parsed.pages && !parsed.elements) {
        error = 'Warning: JSON has no "pages" or "elements" array. SurveyJS may render empty.';
        return;
      }
      error = "";
    } catch (e) {
      error = `Invalid JSON: ${(e as Error).message}`;
    }
  }

  function handleImport() {
    fileInput?.click();
  }

  function handleFileChange(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      jsonText = reader.result as string;
      applyJson();
    };
    reader.readAsText(file);
  }
</script>

<div class="json-editor">
  <div class="editor-toolbar">
    <button class="btn-tool" onclick={handleImport}>Import .json</button>
    <button class="btn-tool" onclick={handleValidate}>Validate</button>
    <button class="btn-tool btn-apply" onclick={applyJson}>Apply</button>
    <input
      bind:this={fileInput}
      type="file"
      accept=".json"
      style="display:none"
      onchange={handleFileChange}
    />
  </div>

  <textarea
    class="json-textarea"
    value={jsonText}
    oninput={handleInput}
    onblur={applyJson}
    placeholder="Paste SurveyJS JSON here..."
    spellcheck="false"
  ></textarea>

  {#if error}
    <div class="json-error">{error}</div>
  {/if}
</div>

<style>
  .json-editor { font-size: 12px; }
  .editor-toolbar {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 0.35rem;
  }
  .btn-tool {
    font-size: 11px;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    background: var(--white);
    cursor: pointer;
  }
  .btn-tool:hover { border-color: var(--black); }
  .btn-apply { background: var(--black); color: var(--white); border-color: var(--black); }
  .btn-apply:hover { background: var(--gray-700); }
  .json-textarea {
    width: 100%;
    min-height: 300px;
    padding: 0.5rem;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 11px;
    line-height: 1.4;
    resize: vertical;
    box-sizing: border-box;
    tab-size: 2;
  }
  .json-textarea:focus { outline: none; border-color: var(--black); }
  .json-error {
    margin-top: 0.25rem;
    padding: 0.35rem 0.5rem;
    background: var(--danger-dim);
    border: 1px solid var(--danger);
    border-radius: var(--radius);
    color: var(--danger);
    font-size: 11px;
  }
</style>
