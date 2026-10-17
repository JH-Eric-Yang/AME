<script lang="ts">
  import "./fields.css";

  interface Props {
    label: string;
    value: number | null | undefined;
    min?: number;
    max?: number;
    step?: number;
    placeholder?: string;
    hint?: string;
    /** When true, the parsed value is truncated with `Math.trunc` before `onchange`, matching `parseInt`'s truncation. Default `false` (parseFloat behaviour). */
    integer?: boolean;
    /** null when the field is blank or not a number. */
    onchange: (value: number | null) => void;
  }

  let { label, value, min, max, step, placeholder = "", hint, integer = false, onchange }: Props = $props();

  function handleInput(e: Event & { currentTarget: HTMLInputElement }) {
    const n = parseFloat(e.currentTarget.value);
    if (!Number.isFinite(n)) {
      onchange(null);
      return;
    }
    onchange(integer ? Math.trunc(n) : n);
  }
</script>

<div class="el-field">
  <label>
    <span>{label}</span>
    <input type="number" value={value ?? ""} {min} {max} {step} {placeholder} oninput={handleInput} />
  </label>
  {#if hint}<span class="hint">{hint}</span>{/if}
</div>
