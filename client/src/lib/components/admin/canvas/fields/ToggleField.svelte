<script lang="ts">
  import "./fields.css";

  interface Props {
    label: string;
    checked: boolean;
    hint?: string;
    onchange: (checked: boolean) => void;
  }

  let { label, checked, hint, onchange }: Props = $props();
</script>

<div class="el-field el-field-toggle">
  <label>
    <input type="checkbox" {checked} onchange={(e) => onchange(e.currentTarget.checked)} />
    <span>{label}</span>
  </label>
  {#if hint}<span class="hint">{hint}</span>{/if}
</div>
