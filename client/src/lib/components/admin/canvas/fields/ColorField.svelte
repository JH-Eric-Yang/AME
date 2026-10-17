<script lang="ts">
  import "./fields.css";

  interface Props {
    label: string;
    /** The stored value; may be any CSS colour the researcher typed. */
    value: string | null | undefined;
    /** What the swatch shows when nothing is stored. Must be #rrggbb. */
    fallback: string;
    /** Offer a "None" button that stores null. */
    clearable?: boolean;
    onchange: (value: string | null) => void;
  }

  let { label, value, fallback, clearable = false, onchange }: Props = $props();

  // <input type="color"> only accepts #rrggbb; anything else it silently
  // shows as black. The text input beside it keeps the raw stored value so a
  // researcher who typed "red" still sees "red".
  const HexPattern = /^#[0-9a-fA-F]{6}$/;
  const swatch = $derived(value && HexPattern.test(value) ? value : fallback);
</script>

<div class="el-field el-field-color">
  <span class="el-field-label">{label}</span>
  <div class="row">
    <input type="color" value={swatch} aria-label="{label} swatch" oninput={(e) => onchange(e.currentTarget.value)} />
    <input type="text" value={value ?? ""} placeholder={clearable ? "None" : fallback} aria-label={label} oninput={(e) => onchange(e.currentTarget.value || null)} />
    {#if clearable && value}
      <button type="button" class="clear" onclick={() => onchange(null)}>None</button>
    {/if}
  </div>
</div>
