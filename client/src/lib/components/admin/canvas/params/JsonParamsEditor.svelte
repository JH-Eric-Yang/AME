<script lang="ts">
  import type { ElementParams } from "ame-shared";
  import "../fields/fields.css";

  let { params, onchange }: { params: ElementParams; onchange: (params: ElementParams) => void } = $props();
</script>

<p class="caption">Edit params as JSON:</p>
<div class="el-field">
  <textarea rows="6" value={JSON.stringify(params, null, 2)} oninput={(e) => {
    try {
      onchange(JSON.parse(e.currentTarget.value));
    } catch {
      /* ignore parse errors while typing */
    }
  }}></textarea>
</div>

<style>
  .caption { font-size: 11px; color: var(--gray-400); }
</style>
