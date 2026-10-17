<script lang="ts">
  import "./fields.css";

  interface Props {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    hint?: string;
    onchange: (value: string) => void;
  }

  let { label, value, options, hint, onchange }: Props = $props();
</script>

<div class="el-field">
  <label>
    <span>{label}</span>
    <select {value} aria-label={label} onchange={(e) => onchange(e.currentTarget.value)}>
      {#each options as opt (opt.value)}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
  </label>
  {#if hint}<span class="hint">{hint}</span>{/if}
</div>
