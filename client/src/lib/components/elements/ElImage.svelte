<script lang="ts">
  import type { ElementConfig, ImageParams } from "ame-shared";
  import { resolveSrc } from "$lib/media/assetSrc";

  let { element }: { element: ElementConfig } = $props();
  const p = $derived(element.params as ImageParams);
</script>

<div class="el-image">
  <img
    src={resolveSrc(p.src)}
    alt={p.alt ?? ""}
    style="width: {p.width ?? 'auto'}; height: {p.height ?? 'auto'}; object-fit: {p.objectFit ?? 'contain'};"
  />
</div>

<style>
  .el-image { display: flex; justify-content: center; }
  img { max-width: 100%; border-radius: var(--radius-sm); }
</style>
