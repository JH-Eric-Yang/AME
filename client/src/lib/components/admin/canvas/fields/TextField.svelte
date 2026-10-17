<script lang="ts">
  import "./fields.css";

  interface Props {
    label: string;
    value: string | undefined;
    placeholder?: string;
    hint?: string;
    onchange: (value: string) => void;
  }

  let { label, value, placeholder = "", hint, onchange }: Props = $props();
</script>

<div class="el-field">
  <label>
    <span>{label}</span>
    <input type="text" value={value ?? ""} {placeholder} oninput={(e) => onchange(e.currentTarget.value)} />
  </label>
  {#if hint}<span class="hint">{hint}</span>{/if}
</div>
