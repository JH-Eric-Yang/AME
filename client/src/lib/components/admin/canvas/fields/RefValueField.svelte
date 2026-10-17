<script lang="ts">
  import "./fields.css";
  import { isRef, parseRef } from "ame-shared/refs";
  import { useRefPicker } from "$lib/admin/refPickerContext";
  import { describeRef } from "$lib/admin/progressSummary";

  interface Props {
    label: string;
    value: unknown;
    /** "number" parses what is typed; "text" keeps it as typed. */
    inputType?: "text" | "number";
    placeholder?: string;
    hint?: string;
    onchange: (value: string | number | undefined) => void;
  }

  let { label, value, inputType = "text", placeholder = "", hint, onchange }: Props = $props();

  const picker = useRefPicker();
  const ref = $derived(isRef(value) ? value : null);
  const parsed = $derived(ref ? parseRef(ref) : null);
  const shown = $derived(value === undefined || value === null ? "" : Array.isArray(value) ? value.join(", ") : String(value));

  function edit(raw: string) {
    if (raw.trim() === "") {
      onchange(undefined);
      return;
    }
    if (inputType === "number") {
      const n = Number(raw);
      onchange(Number.isFinite(n) ? n : undefined);
      return;
    }
    onchange(raw);
  }

  function pickEarlierAnswer() {
    picker?.open({ kind: "value", onpick: (picked) => onchange(picked) });
  }
</script>

<div class="el-field el-field-ref">
  <span class="el-field-label">{label}</span>
  {#if ref}
    <div class="row">
      <span class="badge">Earlier answer</span>
      <span class="ref">{parsed ? describeRef(parsed) : ref}</span>
      {#if picker}<button type="button" class="small" onclick={pickEarlierAnswer}>Change</button>{/if}
      <button type="button" class="small" onclick={() => onchange(undefined)}>Clear</button>
    </div>
  {:else}
    <div class="row">
      <input type={inputType} aria-label={label} value={shown} {placeholder} oninput={(e) => edit(e.currentTarget.value)} />
      {#if picker}<button type="button" class="small" onclick={pickEarlierAnswer}>Earlier answer&hellip;</button>{/if}
    </div>
  {/if}
  {#if hint}<span class="hint">{hint}</span>{/if}
</div>
