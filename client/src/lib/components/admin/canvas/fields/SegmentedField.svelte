<script lang="ts">
  import "./fields.css";

  interface Props {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onchange: (value: string) => void;
  }

  let { label, value, options, onchange }: Props = $props();
</script>

<div class="el-field el-field-segmented">
  <span class="el-field-label">{label}</span>
  <div class="group" role="group" aria-label={label}>
    {#each options as opt (opt.value)}
      <button type="button" aria-pressed={value === opt.value} onclick={() => onchange(opt.value)}>
        {opt.label}
      </button>
    {/each}
  </div>
</div>
