<script lang="ts">
  import type { AssetSummary } from "$lib/api";
  import { resolveSrc, assetRef } from "$lib/media/assetSrc";

  interface Props {
    assets: AssetSummary[];
    /** Only offer media this element can actually present. */
    accept: "image" | "video" | "audio";
    /** Single mode: a click picks one file and closes. */
    onpick?: (asset: AssetSummary) => void;
    /** Multiple mode: clicks toggle files, in click order, until "Use". */
    multiple?: boolean;
    onpickmany?: (assets: AssetSummary[]) => void;
    onclose: () => void;
  }

  let { assets, accept, onpick, multiple = false, onpickmany, onclose }: Props = $props();
  let chosen = $state<AssetSummary[]>([]);

  const choosable = $derived(
    assets.filter((asset) => !asset.missing && asset.mimeType.startsWith(`${accept}/`)),
  );
  const orderOf = (asset: AssetSummary) => chosen.findIndex((a) => a.id === asset.id);

  function choose(asset: AssetSummary) {
    if (!multiple) { onpick?.(asset); return; }
    chosen = orderOf(asset) >= 0 ? chosen.filter((a) => a.id !== asset.id) : [...chosen, asset];
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === "Escape") onclose(); }} />

<div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Choose media" tabindex="-1">
    <h3>Choose {accept}</h3>

    {#if choosable.length === 0}
      <p class="empty">
        No {accept} files in this experiment yet. Upload them in the Media tab.
      </p>
    {:else}
      <div class="grid">
        {#each choosable as asset (asset.id)}
          <button class="tile" class:chosen={orderOf(asset) >= 0} aria-pressed={multiple ? orderOf(asset) >= 0 : undefined} onclick={() => choose(asset)}>
            {#if multiple && orderOf(asset) >= 0}<span class="order">{orderOf(asset) + 1}</span>{/if}
            {#if accept === "image"}
              <img src={resolveSrc(assetRef(asset.id))} alt={asset.fileName} />
            {:else}
              <span class="glyph" aria-hidden="true">&#9654;</span>
            {/if}
            <span class="name">{asset.fileName}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="footer">
      {#if multiple}
        <button class="btn" disabled={chosen.length === 0} onclick={() => onpickmany?.(chosen)}>
          Use {chosen.length} file{chosen.length === 1 ? "" : "s"}
        </button>
      {/if}
      <button class="btn" onclick={onclose}>Cancel</button>
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 50; }
  .dialog { background: #fff; padding: 16px; max-width: 560px; max-height: 70vh; overflow: auto; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; margin: 12px 0; }
  .tile { display: flex; flex-direction: column; gap: 4px; border: 1px solid var(--gray-200); background: var(--white); padding: 6px; cursor: pointer; }
  .tile img { max-width: 100%; max-height: 72px; object-fit: contain; }
  .glyph { font-size: 24px; }
  .name { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { font-size: 12px; color: var(--gray-600); }
  .btn { font-size: 12px; padding: 0.25rem 0.5rem; border: 1px solid var(--gray-200); border-radius: var(--radius); background: var(--white); cursor: pointer; }
  .btn:hover { border-color: var(--black); }
  .tile { position: relative; }
  .tile.chosen { border-color: var(--black); }
  .order { position: absolute; top: 2px; right: 4px; font-size: 11px; font-weight: 600; }
  .footer { display: flex; gap: 6px; }
  .btn:disabled { opacity: 0.4; cursor: default; }
</style>
