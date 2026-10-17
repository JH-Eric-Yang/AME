<script lang="ts">
  import { parseRef } from "ame-shared/refs";
  import { describeRef } from "$lib/admin/progressSummary";
  import {
    whoOptions, whereOptions, elementOptions, buildRef,
    type RefOptionsInput, type WhereOption, type ElementOption,
  } from "$lib/admin/refOptions";

  let { input, onpick, onclose }: { input: RefOptionsInput; onpick: (ref: string) => void; onclose: () => void } = $props();

  const whos = $derived(whoOptions(input));
  const wheres = $derived(whereOptions(input));

  let whoKind = $state<"self" | "partner" | "seat">("self");
  let whoIndex = $state(1);
  /** The chosen step's label: the option objects are rebuilt whenever the
   * lists recompute, so identity would silently drop the selection. */
  let whereLabel = $state<string | null>(null);
  let element = $state<ElementOption | null>(null);
  let field = $state("");

  const whoValue = $derived(whoKind === "self" ? "self" : `${whoKind}:${whoIndex}`);
  const whoMax = $derived(whos.find((w) => w.kind === whoKind)?.max ?? null);
  const where = $derived(
    [...wheres.byStep, ...wheres.byTrial].find((o) => o.label === whereLabel) ?? null,
  );
  const elements = $derived(where ? elementOptions(where.targets, input.routines, input.kind) : []);
  const ref = $derived(where && element ? buildRef(whoValue, where.value, element.name, field || undefined) : null);
  const preview = $derived(ref ? describeRef(parseRef(ref)!) : "");

  function chooseWhere(option: WhereOption) {
    whereLabel = option.label;
    element = null;
    field = "";
  }

  function use() {
    if (!ref) return;
    onpick(ref);
    onclose();
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === "Escape") onclose(); }} />

<div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Choose a reference" tabindex="-1">
    <h3>Use earlier data</h3>

    <section>
      <h4>Whose</h4>
      {#each whos as who (who.kind)}
        <!-- max 0 partners means a one-member group: there is nobody to reference. -->
        {@const none = who.kind === "partner" && who.max === 0}
        <label class="who" class:disabled={none} title={none ? "No partner in this group" : undefined}>
          <input type="radio" name="who" value={who.kind} checked={whoKind === who.kind} disabled={none} onchange={() => (whoKind = who.kind)} />
          {who.label}
        </label>
      {/each}
      {#if whoKind !== "self"}
        <input
          type="number"
          class="index"
          aria-label={whoKind === "partner" ? "Partner number" : "Seat number"}
          min="1"
          max={whoMax ?? undefined}
          value={whoIndex}
          oninput={(e) => (whoIndex = Math.max(1, Number(e.currentTarget.value) || 1))}
        />
      {/if}
    </section>

    <section class="where">
      <h4>From which step</h4>
      <div class="lists">
        <div>
          <p class="list-label">By step</p>
          {#each wheres.byStep as option (option.label)}
            <button type="button" class="opt" class:chosen={whereLabel === option.label} disabled={option.disabledReason !== null} title={option.disabledReason ?? undefined} onclick={() => chooseWhere(option)}>{option.label}</button>
          {/each}
          {#if wheres.byStep.length === 0}<p class="empty">No earlier step.</p>{/if}
        </div>
        <div>
          <p class="list-label">By trial</p>
          {#each wheres.byTrial as option (option.label)}
            <button type="button" class="opt" class:chosen={whereLabel === option.label} disabled={option.disabledReason !== null} title={option.disabledReason ?? undefined} onclick={() => chooseWhere(option)}>{option.label}</button>
          {/each}
        </div>
      </div>
    </section>

    {#if where}
      <section>
        <h4>Which element</h4>
        {#each elements as option (option.name)}
          <button type="button" class="opt" class:chosen={element === option} onclick={() => { element = option; field = ""; }}>{option.name} &middot; {option.type}</button>
        {/each}
        {#if elements.length === 0}<p class="empty">No element at that step produces what this field needs.</p>{/if}
      </section>
    {/if}

    {#if element && element.fields.length > 0}
      <section>
        <h4>Which part</h4>
        <select aria-label="Field" value={field} onchange={(e) => (field = e.currentTarget.value)}>
          <option value="">whole value</option>
          {#each element.fields as f (f.value)}<option value={f.value}>{f.label}</option>{/each}
        </select>
      </section>
    {/if}

    <p class="preview mono">{ref ?? "…"}{#if preview} &mdash; {preview}{/if}</p>
    <div class="actions">
      <button type="button" class="btn" onclick={onclose}>Cancel</button>
      <button type="button" class="btn primary" disabled={!ref} onclick={use}>Use reference</button>
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); display: flex; align-items: center; justify-content: center; z-index: 50; }
  .dialog { background: #fff; padding: 16px; width: min(640px, 92vw); max-height: 80vh; overflow: auto; }
  h3 { margin: 0 0 8px; font-size: 15px; }
  h4 { margin: 12px 0 4px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--gray-400); }
  .who { display: inline-flex; align-items: center; gap: 4px; margin-right: 12px; font-size: 13px; }
  .who.disabled { color: var(--gray-400); }
  .index { width: 4rem; margin-left: 4px; }
  .lists { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .list-label { margin: 0 0 4px; font-size: 11px; color: var(--gray-500); }
  .opt { display: block; width: 100%; text-align: left; padding: 4px 8px; margin-bottom: 2px; border: 1px solid var(--gray-200); background: #fff; font: inherit; font-size: 13px; cursor: pointer; }
  .opt.chosen { border-color: var(--black); background: var(--gray-50); }
  .opt:disabled { color: var(--gray-400); cursor: not-allowed; }
  .empty { font-size: 12px; color: var(--gray-500); }
  .preview { margin: 12px 0 8px; font-size: 12px; }
  .mono { font-family: ui-monospace, monospace; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
  .btn { padding: 6px 12px; border: 1px solid var(--black); background: #fff; font: inherit; cursor: pointer; }
  .btn.primary { background: var(--black); color: #fff; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
