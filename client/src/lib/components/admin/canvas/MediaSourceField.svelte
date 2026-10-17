<script lang="ts">
  import { onMount } from "svelte";
  import { listAssets, type AssetSummary } from "$lib/api";
  import { describeSource } from "$lib/media/sourceState";
  import { resolveSrc, assetRef } from "$lib/media/assetSrc";
  import { useRefPicker } from "$lib/admin/refPickerContext";
  import { describeRef } from "$lib/admin/progressSummary";
  import AssetPickerDialog from "./AssetPickerDialog.svelte";

  interface Props {
    src: string | undefined;
    experimentId: string;
    accept: "image" | "video" | "audio";
    onchange: (src: string) => void;
  }

  let { src, experimentId, accept, onchange }: Props = $props();

  const picker = useRefPicker();

  let assets = $state<AssetSummary[]>([]);
  let picking = $state(false);

  const sourceState = $derived(describeSource(src, assets));

  onMount(async () => {
    try {
      assets = (await listAssets(experimentId)).assets;
    } catch {
      // A failed listing degrades to URL-only editing rather than blocking it.
      assets = [];
    }
  });

  function pick(asset: AssetSummary) {
    onchange(assetRef(asset.id));
    picking = false;
  }

  /**
   * The URL field is offered in exactly two of the four states, and is rendered
   * ONCE, outside the {#if} chain. Rendering it inside both branches destroyed
   * and recreated the <input> on the first character typed — `empty` becomes
   * `external` the moment `src` is set — so focus was lost mid-word. Keeping
   * one element keeps its identity across that transition.
   */
  const showUrlField = $derived(
    sourceState.kind === "empty" || sourceState.kind === "external",
  );
</script>

<div class="source-field">
  <span class="label">Source</span>

  {#if sourceState.kind === "asset"}
    <div class="chosen">
      {#if accept === "image"}
        <img src={resolveSrc(src)} alt={sourceState.asset.fileName} />
      {/if}
      <div class="detail">
        <span class="name">{sourceState.asset.fileName}</span>
        <span class="meta">{Math.round(sourceState.asset.size / 1024)} KB &middot; {sourceState.asset.mimeType}</span>
      </div>
    </div>
    <div class="actions">
      <button class="btn" onclick={() => (picking = true)}>Change</button>
      <button class="btn" onclick={() => onchange("")}>Clear</button>
    </div>
  {:else if sourceState.kind === "reference"}
    <div class="chosen">
      <span class="badge">Earlier data</span>
      <span class="name mono">{sourceState.parsed ? describeRef(sourceState.parsed) : sourceState.ref}</span>
      <span class="actions">
        {#if picker}<button type="button" class="btn" onclick={() => picker.open({ kind: "media", onpick: onchange })}>Change</button>{/if}
        <button type="button" class="btn" onclick={() => onchange("")}>Clear</button>
      </span>
    </div>
  {:else if sourceState.kind === "missing"}
    <p class="warn">
      Missing file — {sourceState.fileName ?? `asset ${sourceState.assetId}`} is not uploaded.
      Restore it in the Media tab.
    </p>
    <div class="actions">
      <button class="btn" onclick={() => (picking = true)}>Choose from library&hellip;</button>
      <button class="btn" onclick={() => onchange("")}>Clear</button>
    </div>
  {:else if sourceState.kind === "external"}
    <p class="external">
      <span class="badge">external</span>
      {sourceState.url}
    </p>
    <span class="hint">External media does not travel with a JSON export.</span>
    <div class="actions">
      <button class="btn" onclick={() => (picking = true)}>Use library file&hellip;</button>
      <button class="btn" onclick={() => onchange("")}>Clear</button>
    </div>
  {:else}
    <p class="warn">No source set — this element will render blank.</p>
    <div class="actions">
      <button class="btn" onclick={() => (picking = true)}>Choose from library&hellip;</button>
      {#if picker}<button type="button" class="btn" onclick={() => picker.open({ kind: "media", onpick: onchange })}>Earlier recording&hellip;</button>{/if}
    </div>
  {/if}

  {#if showUrlField}
    <label class="url">
      <span>or paste a URL</span>
      <input
        type="text"
        value={sourceState.kind === "external" ? sourceState.url : ""}
        placeholder="https://&hellip;"
        oninput={(e) => onchange(e.currentTarget.value)}
      />
    </label>
  {/if}
</div>

{#if picking}
  <AssetPickerDialog {assets} {accept} onpick={pick} onclose={() => (picking = false)} />
{/if}

<style>
  .source-field { display: flex; flex-direction: column; gap: 6px; }
  .label { font-size: 12px; font-weight: 600; }
  .chosen { display: flex; gap: 8px; align-items: center; }
  .chosen img { width: 56px; height: 56px; object-fit: contain; border: 1px solid var(--gray-200); }
  .detail { display: flex; flex-direction: column; }
  .name { font-size: 12px; }
  .mono { font-family: ui-monospace, monospace; }
  .meta, .hint { font-size: 11px; color: var(--gray-600); }
  .actions { display: flex; gap: 6px; }
  .warn { font-size: 12px; color: var(--danger); margin: 0; }
  .external { font-size: 12px; margin: 0; word-break: break-all; }
  .badge { border: 1px solid var(--gray-600); font-size: 10px; padding: 0 4px; margin-right: 4px; }
  .url { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--gray-600); }
  .btn { font-size: 12px; padding: 0.25rem 0.5rem; border: 1px solid var(--gray-200); border-radius: var(--radius); background: var(--white); cursor: pointer; }
  .btn:hover { border-color: var(--black); }
</style>
