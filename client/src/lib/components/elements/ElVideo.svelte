<script lang="ts">
  import type { ElementConfig, VideoParams } from "ame-shared";
  import { resolveSrc } from "$lib/media/assetSrc";

  let { element }: { element: ElementConfig } = $props();
  const p = $derived(element.params as VideoParams);
</script>

<div class="el-video">
  <video
    src={resolveSrc(p.src)}
    autoplay={p.autoplay ?? false}
    loop={p.loop ?? false}
    controls={p.controls ?? true}
    muted={p.muted ?? false}
  >
    <track kind="captions" />
  </video>
</div>

<style>
  .el-video { display: flex; justify-content: center; }
  video { max-width: 100%; border-radius: var(--radius-sm); }
</style>
