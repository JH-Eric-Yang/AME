<script lang="ts">
  import type { PropertyFilter, PropertyFilterOperator } from "ame-shared";
  import { useRefPicker } from "$lib/admin/refPickerContext";
  import { parseFilterValue, formatFilterValue } from "$lib/admin/filterValues";

  interface Props {
    filters: PropertyFilter[];
    onchange: (filters: PropertyFilter[]) => void;
    /** Offer an earlier answer as a filter's property (element Show When). Matching slots compare stored properties only. */
    allowReferences?: boolean;
  }

  let { filters, onchange, allowReferences = false }: Props = $props();

  // Looked up unconditionally (like the other refPickerContext consumers) so
  // the value is never read outside reactive tracking; `allowReferences`
  // gates only whether the affordance renders, in the template below.
  const picker = useRefPicker();

  const Operators: { value: PropertyFilterOperator; label: string }[] = [
    { value: "eq", label: "=" },
    { value: "neq", label: "!=" },
    { value: "gt", label: ">" },
    { value: "lt", label: "<" },
    { value: "gte", label: ">=" },
    { value: "lte", label: "<=" },
    { value: "in", label: "in" },
  ];

  function updateFilter(index: number, patch: Partial<PropertyFilter>) {
    const updated = [...filters];
    updated[index] = { ...updated[index], ...patch };
    onchange(updated);
  }

  function removeFilter(index: number) {
    onchange(filters.filter((_, i) => i !== index));
  }

  function addFilter() {
    onchange([...filters, { property: "", operator: "eq", value: "" }]);
  }
</script>

<div class="filter-editor">
  {#each filters as filter, idx}
    <div class="filter-row">
      <input
        type="text"
        class="filter-prop"
        value={filter.property}
        placeholder="property"
        oninput={(e) => updateFilter(idx, { property: e.currentTarget.value })}
      />
      {#if allowReferences && picker}
        <button
          type="button"
          class="filter-ref"
          title="Compare an earlier answer"
          onclick={() => picker.open({ kind: "value", onpick: (ref) => updateFilter(idx, { property: ref }) })}
        >ref</button>
      {/if}
      <select
        class="filter-op"
        value={filter.operator}
        onchange={(e) => updateFilter(idx, { operator: e.currentTarget.value as PropertyFilterOperator })}
      >
        {#each Operators as op}
          <option value={op.value}>{op.label}</option>
        {/each}
      </select>
      <input
        type="text"
        class="filter-val"
        value={formatFilterValue(filter.value)}
        placeholder="value"
        oninput={(e) => updateFilter(idx, { value: parseFilterValue(e.currentTarget.value, filter.operator) })}
      />
      <button class="filter-remove" onclick={() => removeFilter(idx)}>&times;</button>
    </div>
  {/each}
  <button class="filter-add" onclick={addFilter}>+ Add Filter</button>
</div>

<style>
  .filter-editor { display: flex; flex-direction: column; gap: 0.35rem; }
  .filter-row { display: flex; gap: 0.25rem; align-items: center; }
  .filter-prop { flex: 2; padding: 0.25rem 0.4rem; border: 1px solid var(--gray-200); border-radius: var(--radius); font-size: 12px; }
  .filter-op { flex: 0 0 50px; padding: 0.25rem; border: 1px solid var(--gray-200); border-radius: var(--radius); font-size: 12px; }
  .filter-val { flex: 2; padding: 0.25rem 0.4rem; border: 1px solid var(--gray-200); border-radius: var(--radius); font-size: 12px; }
  .filter-prop:focus, .filter-op:focus, .filter-val:focus { outline: none; border-color: var(--black); }
  .filter-remove { border: none; background: none; color: var(--danger); cursor: pointer; font-size: 14px; padding: 0 0.25rem; line-height: 1; flex-shrink: 0; }
  .filter-add { font-size: 11px; border: none; background: none; color: var(--gray-600); cursor: pointer; padding: 0.25rem 0; text-align: left; }
  .filter-add:hover { color: var(--black); }
  .filter-ref { font-size: 11px; border: 1px solid var(--gray-200); border-radius: var(--radius); background: var(--white); cursor: pointer; padding: 0.15rem 0.35rem; flex-shrink: 0; }
</style>
