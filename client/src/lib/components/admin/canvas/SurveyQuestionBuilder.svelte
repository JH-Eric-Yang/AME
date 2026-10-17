<script lang="ts">
  interface Props {
    surveyJson: Record<string, unknown> | null;
    onchange: (json: Record<string, unknown>) => void;
  }

  let { surveyJson, onchange }: Props = $props();

  // ── Constants ──────────────────────────────────────────

  const QuestionTypes: { value: string; label: string }[] = [
    { value: "radiogroup", label: "Radio Group" },
    { value: "checkbox", label: "Checkbox" },
    { value: "dropdown", label: "Dropdown" },
    { value: "text", label: "Text Input" },
    { value: "comment", label: "Comment (Textarea)" },
    { value: "rating", label: "Rating" },
    { value: "boolean", label: "Boolean" },
    { value: "matrix", label: "Matrix" },
    { value: "matrixdropdown", label: "Matrix Dropdown" },
    { value: "ranking", label: "Ranking" },
    { value: "html", label: "HTML" },
    { value: "nouislider", label: "Slider (noUiSlider)" },
  ];

  const TextInputTypes: string[] = ["text", "email", "number", "date", "tel", "url"];

  const RateTypes: string[] = ["labels", "stars", "smileys"];

  const MatrixCellTypes: string[] = ["dropdown", "checkbox", "radiogroup", "text", "comment", "boolean", "rating"];

  const ChoiceBasedTypes = ["radiogroup", "checkbox", "dropdown", "ranking"];

  // ── Types ──────────────────────────────────────────────

  interface SurveyQuestion {
    type: string;
    name: string;
    title: string;
    isRequired: boolean;
    visibleIf: string;
    enableIf: string;
    collapsed: boolean;
    // Choice-based
    choices: string[];
    hasOther: boolean;
    colCount: number;
    // Checkbox-specific
    maxSelectedChoices: number;
    hasSelectAll: boolean;
    // Text
    inputType: string;
    placeholder: string;
    maxLength: number;
    // Comment
    rows: number;
    // Rating
    rateMin: number;
    rateMax: number;
    rateType: string;
    // Boolean
    labelTrue: string;
    labelFalse: string;
    renderAs: string;
    // Matrix
    matrixRows: { value: string; text: string }[];
    matrixColumns: { value: string; text: string }[];
    cellType: string;
    // HTML
    html: string;
    // nouislider
    rangeMin: number;
    rangeMax: number;
    step: number;
  }

  interface SurveyPage {
    name: string;
    questions: SurveyQuestion[];
  }

  // ── Helpers ────────────────────────────────────────────

  function createDefaultQuestion(type: string): SurveyQuestion {
    return {
      type,
      name: `q${Date.now()}`,
      title: "",
      isRequired: false,
      visibleIf: "",
      enableIf: "",
      collapsed: false,
      choices: ["Option 1", "Option 2", "Option 3"],
      hasOther: false,
      colCount: 0,
      maxSelectedChoices: 0,
      hasSelectAll: false,
      inputType: "text",
      placeholder: "",
      maxLength: 0,
      rows: 4,
      rateMin: 1,
      rateMax: 5,
      rateType: "labels",
      labelTrue: "Yes",
      labelFalse: "No",
      renderAs: "toggle",
      matrixRows: [{ value: "row1", text: "Row 1" }],
      matrixColumns: [{ value: "col1", text: "Column 1" }],
      cellType: "dropdown",
      html: "",
      rangeMin: 0,
      rangeMax: 100,
      step: 1,
    };
  }

  function parseQuestion(raw: Record<string, unknown>): SurveyQuestion {
    const type = (raw.type as string) ?? "text";
    const q = createDefaultQuestion(type);
    q.name = (raw.name as string) ?? q.name;
    q.title = (raw.title as string) ?? "";
    q.isRequired = (raw.isRequired as boolean) ?? false;
    q.visibleIf = (raw.visibleIf as string) ?? "";
    q.enableIf = (raw.enableIf as string) ?? "";

    // Choice-based
    if (Array.isArray(raw.choices)) {
      q.choices = raw.choices.map((c: unknown) =>
        typeof c === "string" ? c : (c as Record<string, string>).text ?? String(c),
      );
    }
    q.hasOther = (raw.hasOther as boolean) ?? false;
    q.colCount = (raw.colCount as number) ?? 0;

    // Checkbox
    q.maxSelectedChoices = (raw.maxSelectedChoices as number) ?? 0;
    q.hasSelectAll = (raw.hasSelectAll as boolean) ?? false;

    // Text
    q.inputType = (raw.inputType as string) ?? "text";
    q.placeholder = ((raw.placeholder ?? raw.placeHolder) as string) ?? "";
    q.maxLength = (raw.maxLength as number) ?? 0;

    // Comment
    q.rows = (raw.rows as number) ?? 4;

    // Rating
    q.rateMin = (raw.rateMin as number) ?? 1;
    q.rateMax = (raw.rateMax as number) ?? 5;
    q.rateType = (raw.rateType as string) ?? "labels";

    // Boolean
    q.labelTrue = (raw.labelTrue as string) ?? "Yes";
    q.labelFalse = (raw.labelFalse as string) ?? "No";
    q.renderAs = (raw.renderAs as string) ?? "toggle";

    // Matrix
    if (Array.isArray(raw.rows) && type.startsWith("matrix")) {
      q.matrixRows = (raw.rows as unknown[]).map((r: unknown) => {
        if (typeof r === "string") return { value: r, text: r };
        const obj = r as Record<string, string>;
        return { value: obj.value ?? obj.text ?? "", text: obj.text ?? obj.value ?? "" };
      });
    }
    if (Array.isArray(raw.columns)) {
      q.matrixColumns = (raw.columns as unknown[]).map((c: unknown) => {
        if (typeof c === "string") return { value: c, text: c };
        const obj = c as Record<string, string>;
        return { value: obj.value ?? obj.text ?? "", text: obj.text ?? obj.value ?? "" };
      });
    }
    q.cellType = (raw.cellType as string) ?? "dropdown";

    // HTML
    q.html = (raw.html as string) ?? "";

    // nouislider
    if (raw.config && typeof raw.config === "object") {
      const cfg = raw.config as Record<string, unknown>;
      q.rangeMin = (cfg.rangeMin as number) ?? 0;
      q.rangeMax = (cfg.rangeMax as number) ?? 100;
      q.step = (cfg.step as number) ?? 1;
    } else {
      q.step = (raw.step as number) ?? 1;
      // Try top-level rangeMin/rangeMax
      q.rangeMin = (raw.rangeMin as number) ?? 0;
      q.rangeMax = (raw.rangeMax as number) ?? 100;
    }

    return q;
  }

  function parseSurveyJson(json: Record<string, unknown> | null): SurveyPage[] {
    if (!json) return [{ name: "page1", questions: [] }];

    const rawPages = json.pages as Record<string, unknown>[] | undefined;
    if (Array.isArray(rawPages) && rawPages.length > 0) {
      return rawPages.map((p, idx) => {
        const elements = (p.elements ?? p.questions) as Record<string, unknown>[] | undefined;
        return {
          name: (p.name as string) ?? `page${idx + 1}`,
          questions: Array.isArray(elements) ? elements.map(parseQuestion) : [],
        };
      });
    }

    // Flat format: elements at top level
    const elements = (json.elements ?? json.questions) as Record<string, unknown>[] | undefined;
    if (Array.isArray(elements) && elements.length > 0) {
      return [{ name: "page1", questions: elements.map(parseQuestion) }];
    }

    return [{ name: "page1", questions: [] }];
  }

  function questionToJson(q: SurveyQuestion): Record<string, unknown> {
    const obj: Record<string, unknown> = {
      type: q.type,
      name: q.name,
      title: q.title || undefined,
      isRequired: q.isRequired || undefined,
      visibleIf: q.visibleIf || undefined,
      enableIf: q.enableIf || undefined,
    };

    if (ChoiceBasedTypes.includes(q.type)) {
      obj.choices = q.choices;
      if (q.hasOther) obj.hasOther = true;
      if (q.colCount > 0) obj.colCount = q.colCount;
    }

    if (q.type === "checkbox") {
      if (q.maxSelectedChoices > 0) obj.maxSelectedChoices = q.maxSelectedChoices;
      if (q.hasSelectAll) obj.hasSelectAll = true;
    }

    if (q.type === "text") {
      if (q.inputType !== "text") obj.inputType = q.inputType;
      if (q.placeholder) obj.placeholder = q.placeholder;
      if (q.maxLength > 0) obj.maxLength = q.maxLength;
    }

    if (q.type === "comment") {
      if (q.placeholder) obj.placeholder = q.placeholder;
      if (q.maxLength > 0) obj.maxLength = q.maxLength;
      if (q.rows !== 4) obj.rows = q.rows;
    }

    if (q.type === "rating") {
      obj.rateMin = q.rateMin;
      obj.rateMax = q.rateMax;
      if (q.rateType !== "labels") obj.rateType = q.rateType;
    }

    if (q.type === "boolean") {
      if (q.labelTrue !== "Yes") obj.labelTrue = q.labelTrue;
      if (q.labelFalse !== "No") obj.labelFalse = q.labelFalse;
      if (q.renderAs !== "toggle") obj.renderAs = q.renderAs;
    }

    if (q.type === "matrix" || q.type === "matrixdropdown") {
      obj.columns = q.matrixColumns;
      obj.rows = q.matrixRows;
      if (q.type === "matrixdropdown") {
        obj.cellType = q.cellType;
      }
    }

    if (q.type === "html") {
      obj.html = q.html;
    }

    if (q.type === "nouislider") {
      obj.config = {
        rangeMin: q.rangeMin,
        rangeMax: q.rangeMax,
        step: q.step,
      };
    }

    // Strip undefined values
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
  }

  function pagesToJson(pgs: SurveyPage[]): Record<string, unknown> {
    return {
      pages: pgs.map((p) => ({
        name: p.name,
        elements: p.questions.map(questionToJson),
      })),
    };
  }

  // ── State ──────────────────────────────────────────────

  let pages: SurveyPage[] = $state(parseSurveyJson(surveyJson));
  let addTypeDropdown: Record<string, string> = $state({});

  // Re-parse when surveyJson prop changes externally
  let lastJsonStr = $state(JSON.stringify(surveyJson));
  $effect(() => {
    const str = JSON.stringify(surveyJson);
    if (str !== lastJsonStr) {
      lastJsonStr = str;
      pages = parseSurveyJson(surveyJson);
    }
  });

  function emitChange() {
    const json = pagesToJson(pages);
    lastJsonStr = JSON.stringify(json);
    onchange(json);
  }

  // ── Page actions ───────────────────────────────────────

  function addPage() {
    pages.push({ name: `page${pages.length + 1}`, questions: [] });
    emitChange();
  }

  function removePage(pageIdx: number) {
    if (pages.length <= 1) return;
    pages.splice(pageIdx, 1);
    emitChange();
  }

  function updatePageName(pageIdx: number, name: string) {
    pages[pageIdx].name = name;
    emitChange();
  }

  // ── Question actions ───────────────────────────────────

  function addQuestion(pageIdx: number) {
    const type = addTypeDropdown[`p${pageIdx}`] || "text";
    pages[pageIdx].questions.push(createDefaultQuestion(type));
    emitChange();
  }

  function removeQuestion(pageIdx: number, qIdx: number) {
    pages[pageIdx].questions.splice(qIdx, 1);
    emitChange();
  }

  function moveQuestion(pageIdx: number, qIdx: number, direction: -1 | 1) {
    const qs = pages[pageIdx].questions;
    const target = qIdx + direction;
    if (target < 0 || target >= qs.length) return;
    [qs[qIdx], qs[target]] = [qs[target], qs[qIdx]];
    emitChange();
  }

  function toggleCollapsed(pageIdx: number, qIdx: number) {
    pages[pageIdx].questions[qIdx].collapsed = !pages[pageIdx].questions[qIdx].collapsed;
  }

  function updateQuestion(pageIdx: number, qIdx: number) {
    emitChange();
  }

  // ── Choice helpers ─────────────────────────────────────

  function addChoice(pageIdx: number, qIdx: number) {
    const q = pages[pageIdx].questions[qIdx];
    q.choices.push(`Option ${q.choices.length + 1}`);
    emitChange();
  }

  function removeChoice(pageIdx: number, qIdx: number, cIdx: number) {
    pages[pageIdx].questions[qIdx].choices.splice(cIdx, 1);
    emitChange();
  }

  function updateChoice(pageIdx: number, qIdx: number, cIdx: number, value: string) {
    pages[pageIdx].questions[qIdx].choices[cIdx] = value;
    emitChange();
  }

  // ── Matrix helpers ─────────────────────────────────────

  function addMatrixRow(pageIdx: number, qIdx: number) {
    const q = pages[pageIdx].questions[qIdx];
    const n = q.matrixRows.length + 1;
    q.matrixRows.push({ value: `row${n}`, text: `Row ${n}` });
    emitChange();
  }

  function removeMatrixRow(pageIdx: number, qIdx: number, rIdx: number) {
    pages[pageIdx].questions[qIdx].matrixRows.splice(rIdx, 1);
    emitChange();
  }

  function addMatrixColumn(pageIdx: number, qIdx: number) {
    const q = pages[pageIdx].questions[qIdx];
    const n = q.matrixColumns.length + 1;
    q.matrixColumns.push({ value: `col${n}`, text: `Column ${n}` });
    emitChange();
  }

  function removeMatrixColumn(pageIdx: number, qIdx: number, cIdx: number) {
    pages[pageIdx].questions[qIdx].matrixColumns.splice(cIdx, 1);
    emitChange();
  }
</script>

<div class="survey-builder">
  <p class="info-notice">
    All SurveyJS question types are supported when importing JSON directly. The builder covers the most common types for convenience.
  </p>

  {#each pages as page, pIdx}
    <fieldset class="page-fieldset">
      <legend>Page {pIdx + 1}</legend>
      <div class="page-header">
        <label class="inline-label">
          <span>Name</span>
          <input
            type="text"
            value={page.name}
            oninput={(e) => updatePageName(pIdx, e.currentTarget.value)}
          />
        </label>
        {#if pages.length > 1}
          <button class="btn-remove-page" onclick={() => removePage(pIdx)}>&times;</button>
        {/if}
      </div>

      {#each page.questions as q, qIdx}
        <div class="question-card">
          <div class="question-header" onclick={() => toggleCollapsed(pIdx, qIdx)}>
            <span class="question-chevron">{q.collapsed ? "\u25B6" : "\u25BC"}</span>
            <span class="question-title-preview">
              {q.title || q.name}
              <span class="question-type-badge">{q.type}</span>
            </span>
            <span class="question-actions">
              <button
                class="btn-move"
                disabled={qIdx === 0}
                onclick={(e) => { e.stopPropagation(); moveQuestion(pIdx, qIdx, -1); }}
              >&uarr;</button>
              <button
                class="btn-move"
                disabled={qIdx === page.questions.length - 1}
                onclick={(e) => { e.stopPropagation(); moveQuestion(pIdx, qIdx, 1); }}
              >&darr;</button>
              <button
                class="btn-remove"
                onclick={(e) => { e.stopPropagation(); removeQuestion(pIdx, qIdx); }}
              >&times;</button>
            </span>
          </div>

          {#if !q.collapsed}
            <div class="question-body">
              <label>
                <span>Name / Key</span>
                <input
                  type="text"
                  bind:value={q.name}
                  oninput={() => updateQuestion(pIdx, qIdx)}
                />
              </label>

              <label>
                <span>Title</span>
                <input
                  type="text"
                  bind:value={q.title}
                  oninput={() => updateQuestion(pIdx, qIdx)}
                />
              </label>

              <label>
                <span>Type</span>
                <select
                  bind:value={q.type}
                  onchange={() => updateQuestion(pIdx, qIdx)}
                >
                  {#each QuestionTypes as qt}
                    <option value={qt.value}>{qt.label}</option>
                  {/each}
                </select>
              </label>

              <label class="checkbox-label">
                <input
                  type="checkbox"
                  bind:checked={q.isRequired}
                  onchange={() => updateQuestion(pIdx, qIdx)}
                />
                <span>Required</span>
              </label>

              <!-- Type-specific fields -->
              {#if ChoiceBasedTypes.includes(q.type)}
                <fieldset class="inner-fieldset">
                  <legend>Choices</legend>
                  {#each q.choices as choice, cIdx}
                    <div class="choice-row">
                      <input
                        type="text"
                        value={choice}
                        oninput={(e) => updateChoice(pIdx, qIdx, cIdx, e.currentTarget.value)}
                      />
                      <button class="btn-remove" onclick={() => removeChoice(pIdx, qIdx, cIdx)}>&times;</button>
                    </div>
                  {/each}
                  <button class="btn-add-small" onclick={() => addChoice(pIdx, qIdx)}>+ Choice</button>

                  <label class="checkbox-label">
                    <input
                      type="checkbox"
                      bind:checked={q.hasOther}
                      onchange={() => updateQuestion(pIdx, qIdx)}
                    />
                    <span>Allow "Other"</span>
                  </label>

                  <label>
                    <span>Columns</span>
                    <input
                      type="number"
                      bind:value={q.colCount}
                      min="0"
                      max="5"
                      oninput={() => updateQuestion(pIdx, qIdx)}
                    />
                  </label>

                  {#if q.type === "checkbox"}
                    <label>
                      <span>Max Selected</span>
                      <input
                        type="number"
                        bind:value={q.maxSelectedChoices}
                        min="0"
                        oninput={() => updateQuestion(pIdx, qIdx)}
                      />
                    </label>
                    <label class="checkbox-label">
                      <input
                        type="checkbox"
                        bind:checked={q.hasSelectAll}
                        onchange={() => updateQuestion(pIdx, qIdx)}
                      />
                      <span>Select All option</span>
                    </label>
                  {/if}
                </fieldset>
              {/if}

              {#if q.type === "text"}
                <fieldset class="inner-fieldset">
                  <legend>Text Options</legend>
                  <label>
                    <span>Input Type</span>
                    <select bind:value={q.inputType} onchange={() => updateQuestion(pIdx, qIdx)}>
                      {#each TextInputTypes as t}
                        <option value={t}>{t}</option>
                      {/each}
                    </select>
                  </label>
                  <label>
                    <span>Placeholder</span>
                    <input type="text" bind:value={q.placeholder} oninput={() => updateQuestion(pIdx, qIdx)} />
                  </label>
                  <label>
                    <span>Max Length (0 = none)</span>
                    <input type="number" bind:value={q.maxLength} min="0" oninput={() => updateQuestion(pIdx, qIdx)} />
                  </label>
                </fieldset>
              {/if}

              {#if q.type === "comment"}
                <fieldset class="inner-fieldset">
                  <legend>Comment Options</legend>
                  <label>
                    <span>Placeholder</span>
                    <input type="text" bind:value={q.placeholder} oninput={() => updateQuestion(pIdx, qIdx)} />
                  </label>
                  <label>
                    <span>Max Length (0 = none)</span>
                    <input type="number" bind:value={q.maxLength} min="0" oninput={() => updateQuestion(pIdx, qIdx)} />
                  </label>
                  <label>
                    <span>Rows</span>
                    <input type="number" bind:value={q.rows} min="1" max="20" oninput={() => updateQuestion(pIdx, qIdx)} />
                  </label>
                </fieldset>
              {/if}

              {#if q.type === "rating"}
                <fieldset class="inner-fieldset">
                  <legend>Rating Options</legend>
                  <label>
                    <span>Min</span>
                    <input type="number" bind:value={q.rateMin} min="0" oninput={() => updateQuestion(pIdx, qIdx)} />
                  </label>
                  <label>
                    <span>Max</span>
                    <input type="number" bind:value={q.rateMax} min="1" oninput={() => updateQuestion(pIdx, qIdx)} />
                  </label>
                  <label>
                    <span>Display</span>
                    <select bind:value={q.rateType} onchange={() => updateQuestion(pIdx, qIdx)}>
                      {#each RateTypes as rt}
                        <option value={rt}>{rt}</option>
                      {/each}
                    </select>
                  </label>
                </fieldset>
              {/if}

              {#if q.type === "boolean"}
                <fieldset class="inner-fieldset">
                  <legend>Boolean Options</legend>
                  <label>
                    <span>True Label</span>
                    <input type="text" bind:value={q.labelTrue} oninput={() => updateQuestion(pIdx, qIdx)} />
                  </label>
                  <label>
                    <span>False Label</span>
                    <input type="text" bind:value={q.labelFalse} oninput={() => updateQuestion(pIdx, qIdx)} />
                  </label>
                  <label>
                    <span>Render As</span>
                    <select bind:value={q.renderAs} onchange={() => updateQuestion(pIdx, qIdx)}>
                      <option value="toggle">Toggle</option>
                      <option value="checkbox">Checkbox</option>
                    </select>
                  </label>
                </fieldset>
              {/if}

              {#if q.type === "matrix" || q.type === "matrixdropdown"}
                <fieldset class="inner-fieldset">
                  <legend>Matrix Rows</legend>
                  {#each q.matrixRows as row, rIdx}
                    <div class="choice-row">
                      <input
                        type="text"
                        value={row.text}
                        oninput={(e) => {
                          q.matrixRows[rIdx] = { ...row, text: e.currentTarget.value, value: row.value };
                          updateQuestion(pIdx, qIdx);
                        }}
                      />
                      <button class="btn-remove" onclick={() => removeMatrixRow(pIdx, qIdx, rIdx)}>&times;</button>
                    </div>
                  {/each}
                  <button class="btn-add-small" onclick={() => addMatrixRow(pIdx, qIdx)}>+ Row</button>
                </fieldset>

                <fieldset class="inner-fieldset">
                  <legend>Matrix Columns</legend>
                  {#each q.matrixColumns as col, cIdx}
                    <div class="choice-row">
                      <input
                        type="text"
                        value={col.text}
                        oninput={(e) => {
                          q.matrixColumns[cIdx] = { ...col, text: e.currentTarget.value, value: col.value };
                          updateQuestion(pIdx, qIdx);
                        }}
                      />
                      <button class="btn-remove" onclick={() => removeMatrixColumn(pIdx, qIdx, cIdx)}>&times;</button>
                    </div>
                  {/each}
                  <button class="btn-add-small" onclick={() => addMatrixColumn(pIdx, qIdx)}>+ Column</button>
                </fieldset>

                {#if q.type === "matrixdropdown"}
                  <label>
                    <span>Cell Type</span>
                    <select bind:value={q.cellType} onchange={() => updateQuestion(pIdx, qIdx)}>
                      {#each MatrixCellTypes as ct}
                        <option value={ct}>{ct}</option>
                      {/each}
                    </select>
                  </label>
                {/if}
              {/if}

              {#if q.type === "html"}
                <fieldset class="inner-fieldset">
                  <legend>HTML Content</legend>
                  <textarea
                    class="html-textarea"
                    rows="5"
                    bind:value={q.html}
                    oninput={() => updateQuestion(pIdx, qIdx)}
                  ></textarea>
                </fieldset>
              {/if}

              {#if q.type === "nouislider"}
                <fieldset class="inner-fieldset">
                  <legend>Slider Options</legend>
                  <label>
                    <span>Min</span>
                    <input type="number" bind:value={q.rangeMin} oninput={() => updateQuestion(pIdx, qIdx)} />
                  </label>
                  <label>
                    <span>Max</span>
                    <input type="number" bind:value={q.rangeMax} oninput={() => updateQuestion(pIdx, qIdx)} />
                  </label>
                  <label>
                    <span>Step</span>
                    <input type="number" bind:value={q.step} min="0.01" step="0.01" oninput={() => updateQuestion(pIdx, qIdx)} />
                  </label>
                </fieldset>
              {/if}

              <!-- Advanced: visibleIf / enableIf -->
              <fieldset class="inner-fieldset">
                <legend>Conditions</legend>
                <label>
                  <span>Visible If</span>
                  <input
                    type="text"
                    bind:value={q.visibleIf}
                    placeholder={"e.g. {q1} = 'Yes'"}
                    oninput={() => updateQuestion(pIdx, qIdx)}
                  />
                </label>
                <label>
                  <span>Enable If</span>
                  <input
                    type="text"
                    bind:value={q.enableIf}
                    placeholder={"e.g. {q2} notempty"}
                    oninput={() => updateQuestion(pIdx, qIdx)}
                  />
                </label>
              </fieldset>
            </div>
          {/if}
        </div>
      {/each}

      <div class="add-question-row">
        <select
          value={addTypeDropdown[`p${pIdx}`] ?? "text"}
          onchange={(e) => { addTypeDropdown[`p${pIdx}`] = e.currentTarget.value; }}
        >
          {#each QuestionTypes as qt}
            <option value={qt.value}>{qt.label}</option>
          {/each}
        </select>
        <button class="btn-add" onclick={() => addQuestion(pIdx)}>+ Question</button>
      </div>
    </fieldset>
  {/each}

  <button class="btn-add-page" onclick={addPage}>+ Add Page</button>
</div>

<style>
  .survey-builder {
    font-size: 12px;
  }

  .info-notice {
    font-size: 11px;
    color: var(--gray-600);
    background: var(--white);
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    padding: 0.5rem;
    margin: 0 0 0.75rem 0;
    line-height: 1.4;
  }

  .page-fieldset {
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    padding: 0.75rem;
    margin-bottom: 0.5rem;
  }

  .page-fieldset > legend {
    font-size: 12px;
    font-weight: 500;
    padding: 0 0.25rem;
  }

  .page-header {
    display: flex;
    align-items: flex-end;
    gap: 0.35rem;
    margin-bottom: 0.5rem;
  }

  .inline-label {
    flex: 1;
    display: block;
    margin-bottom: 0;
  }

  .inline-label span {
    display: block;
    font-size: 11px;
    font-weight: 500;
    margin-bottom: 0.1rem;
    color: var(--gray-700);
  }

  .btn-remove-page {
    background: none;
    border: 1px solid var(--danger);
    color: var(--danger);
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 13px;
    padding: 0.2rem 0.4rem;
    line-height: 1;
    flex-shrink: 0;
    align-self: flex-end;
    margin-bottom: 0;
  }

  /* Question card */

  .question-card {
    background: var(--white);
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    margin-bottom: 0.4rem;
  }

  .question-header {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.5rem;
    cursor: pointer;
    user-select: none;
    font-size: 12px;
  }

  .question-header:hover {
    background: var(--gray-100);
  }

  .question-chevron {
    font-size: 9px;
    color: var(--gray-400);
    flex-shrink: 0;
    width: 10px;
  }

  .question-title-preview {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  .question-type-badge {
    font-size: 10px;
    color: var(--gray-400);
    font-weight: 400;
    margin-left: 0.35rem;
  }

  .question-actions {
    display: flex;
    gap: 0.15rem;
    flex-shrink: 0;
  }

  .btn-move {
    background: var(--white);
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 11px;
    padding: 0.1rem 0.3rem;
    line-height: 1;
    color: var(--gray-700);
  }

  .btn-move:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .btn-remove {
    background: none;
    border: 1px solid var(--danger);
    color: var(--danger);
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 12px;
    padding: 0.1rem 0.3rem;
    line-height: 1;
    flex-shrink: 0;
  }

  .question-body {
    padding: 0.5rem;
    border-top: 1px solid var(--gray-200);
  }

  .question-body label {
    display: block;
    margin-bottom: 0.4rem;
  }

  .question-body label span {
    display: block;
    font-size: 11px;
    font-weight: 500;
    margin-bottom: 0.1rem;
    color: var(--gray-700);
  }

  .checkbox-label {
    display: flex !important;
    align-items: center;
    gap: 0.35rem;
    margin-bottom: 0.4rem;
  }

  .checkbox-label input[type="checkbox"] {
    width: auto;
    margin: 0;
  }

  .checkbox-label span {
    display: inline !important;
    margin-bottom: 0 !important;
  }

  .inner-fieldset {
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    padding: 0.5rem;
    margin: 0.4rem 0;
  }

  .inner-fieldset legend {
    font-size: 11px;
    font-weight: 500;
    padding: 0 0.2rem;
    color: var(--gray-600);
  }

  .choice-row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin-bottom: 0.25rem;
  }

  .choice-row input {
    flex: 1;
  }

  .btn-add-small {
    font-size: 11px;
    border: none;
    background: none;
    color: var(--gray-600);
    cursor: pointer;
    padding: 0.2rem 0;
  }

  .btn-add-small:hover {
    color: var(--black);
  }

  .html-textarea {
    width: 100%;
    font-family: monospace;
    font-size: 11px;
  }

  .add-question-row {
    display: flex;
    gap: 0.35rem;
    margin-top: 0.5rem;
  }

  .add-question-row select {
    flex: 1;
  }

  .btn-add {
    font-size: 11px;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--black);
    border-radius: var(--radius);
    background: var(--white);
    cursor: pointer;
    flex-shrink: 0;
  }

  .btn-add:hover {
    background: var(--black);
    color: var(--white);
  }

  .btn-add-page {
    font-size: 11px;
    border: none;
    background: none;
    color: var(--gray-600);
    cursor: pointer;
    padding: 0.25rem 0;
    margin-top: 0.25rem;
  }

  .btn-add-page:hover {
    color: var(--black);
  }

  /* Shared input styles consistent with RoutineInspector */
  input[type="text"],
  input[type="number"],
  textarea,
  select {
    width: 100%;
    padding: 0.3rem 0.4rem;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius);
    font-size: 12px;
    box-sizing: border-box;
    background: var(--white);
  }

  input:focus,
  textarea:focus,
  select:focus {
    outline: none;
    border-color: var(--black);
  }
</style>
