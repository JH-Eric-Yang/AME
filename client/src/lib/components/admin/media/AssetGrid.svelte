<script lang="ts">
  import type { AssetSummary } from "$lib/api";
  import { resolveSrc, assetRef } from "$lib/media/assetSrc";
  import type { AssetUse } from "ame-shared/assetUsage";

  interface Props {
    assets: AssetSummary[];
    /** Elements and content rows referencing each asset id, from findAssetUsage. */
    usage: Map<string, AssetUse[]>;
    ondelete: (asset: AssetSummary) => void;
  }

  let { assets, usage, ondelete }: Props = $props();

  const KilobytesPerMegabyte = 1024;

  function formatSize(bytes: number): string {
    const kb = bytes / 1024;
    if (kb < KilobytesPerMegabyte) return `${Math.round(kb)} KB`;
    return `${(kb / KilobytesPerMegabyte).toFixed(1)} MB`;
  }

  function usageLabel(assetId: string): string {
    const count = usage.get(assetId)?.length ?? 0;
    if (count === 0) return "unused";
    return count === 1 ? "used 1x" : `used ${count}x`;
  }
</script>

<div class="grid">
  {#each assets as asset (asset.id)}
    <figure class="tile" class:missing={asset.missing}>
      <div class="preview">
        {#if asset.missing}
          <span class="warn" aria-hidden="true">!</span>
        {:else if asset.mimeType.startsWith("image/")}
          <img src={resolveSrc(assetRef(asset.id))} alt={asset.fileName} />
        {:else if asset.mimeType.startsWith("video/")}
          <video src={resolveSrc(assetRef(asset.id))} preload="metadata" muted>
            <track kind="captions" />
          </video>
        {:else}
          <span class="glyph" aria-hidden="true">&#9834;</span>
        {/if}
      </div>
      <figcaption>
        <span class="name" title={asset.fileName}>{asset.fileName}</span>
        <span class="meta">
          {#if asset.missing}
            MISSING &middot; {usageLabel(asset.id)}
          {:else}
            {formatSize(asset.size)} &middot; {usageLabel(asset.id)}
          {/if}
        </span>
      </figcaption>
      <button class="btn" onclick={() => ondelete(asset)}>Delete</button>
    </figure>
  {/each}
</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
  .tile { margin: 0; border: 1px solid var(--gray-200); padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .tile.missing { border-color: var(--danger); }
  .preview { height: 96px; display: flex; align-items: center; justify-content: center; background: var(--white); overflow: hidden; }
  .preview img, .preview video { max-width: 100%; max-height: 96px; }
  .warn { color: var(--danger); font-size: 28px; font-weight: 700; }
  .glyph { font-size: 28px; color: var(--gray-500); }
  figcaption { display: flex; flex-direction: column; gap: 2px; }
  .name { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { font-size: 11px; color: var(--gray-500); }
  .btn { font-size: 11px; padding: 2px 6px; }
</style>
