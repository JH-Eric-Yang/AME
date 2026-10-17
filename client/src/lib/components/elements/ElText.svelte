<script lang="ts">
  import type { ElementConfig, TextParams } from "ame-shared";
  import { textStyleCss } from "ame-shared/textStyle";

  let { element }: { element: ElementConfig } = $props();
  const p = $derived(element.params as TextParams);
</script>

<!-- Every style rule comes from textStyleCss, including line-height: the
     builder's canvas and overflow probe mount this same component, so a
     rule kept in a <style> block here would be one they could not see. -->
<div class="el-text" style={textStyleCss(p)}>
  {@html p.content}
</div>
