<script lang="ts">
  import { onMount } from "svelte";
  import { listAssets, listContent, deleteAsset, type AssetSummary } from "$lib/api";
  import { uploadAsset } from "$lib/media/assetApi";
  import { experiment } from "$lib/stores/experiment";
  import {
    findAssetUsage,
    describeAssetUse,
    type ContentRowRef,
  } from "ame-shared/assetUsage";
  import AssetGrid from "./media/AssetGrid.svelte";

  let { experimentId }: { experimentId: string } = $props();

  /** One failed upload or restore, kept until the researcher dismisses it. */
  interface UploadFailure {
    file: string;
    message: string;
  }

  let assets = $state<AssetSummary[]>([]);
  let loading = $state(true);
  /** Set only by refresh() and handleDelete() — single, non-concurrent actions. */
  let errorMessage = $state("");
  /**
   * Accumulated per-file failures from handleUpload()/handleRestore(), which
   * both loop over a batch of files. Kept separate from errorMessage so a
   * sibling file's successful upload — which calls refresh() — never wipes
   * out the record of files that failed.
   */
  let uploadErrors = $state<UploadFailure[]>([]);
  let uploadingCount = $state(0);
  /**
   * Content rows are half of usage analysis: a per-trial stimulus reference
   * lives in `ExperimentContent.content` and in no routine, so without these an
   * asset a researcher authored into a trial reads as "unused" and is deleted
   * behind a bland confirmation.
   */
  let contents = $state<ContentRowRef[]>([]);
  /** Set when the content rows could not be read, so usage counts are partial. */
  let contentWarning = $state("");

  const usage = $derived(findAssetUsage($experiment.routines, contents));
  const missing = $derived(assets.filter((asset) => asset.missing));

  async function refresh() {
    loading = true;
    try {
      assets = (await listAssets(experimentId)).assets;
      errorMessage = "";
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : "Could not load assets";
    } finally {
      loading = false;
    }
  }

  /**
   * Loaded once, separately from refresh(): an upload cannot change the content
   * rows, and a failure here must not stop the library rendering. It does
   * change what a delete warns about, so it is reported rather than swallowed.
   */
  async function loadContent() {
    try {
      contents = (await listContent(experimentId)) as ContentRowRef[];
      contentWarning = "";
    } catch {
      contentWarning =
        "Content rows could not be read, so usage counts cover routines only.";
    }
  }

  onMount(() => {
    refresh();
    loadContent();
  });

  /**
   * Restore matches a dropped file to a missing row by filename, and only when
   * exactly one row carries that name — guessing would attach a stimulus to the
   * wrong element silently.
   */
  function restoreTarget(file: File): AssetSummary | null | undefined {
    const matches = missing.filter((asset) => asset.fileName === file.name);
    if (matches.length === 1) return matches[0];
    return matches.length === 0 ? null : undefined;
  }

  function addUploadError(file: string, message: string) {
    uploadErrors = [...uploadErrors, { file, message }];
  }

  function dismissUploadErrors() {
    uploadErrors = [];
  }

  function send(file: File, assetId?: string) {
    uploadingCount += 1;
    uploadAsset({
      file,
      experimentId,
      ...(assetId ? { assetId } : {}),
      onSuccess: () => {
        uploadingCount -= 1;
        refresh();
      },
      onError: (err) => {
        uploadingCount -= 1;
        addUploadError(file.name, err.message);
      },
    });
  }

  function handleUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    for (const file of Array.from(input.files ?? [])) send(file);
    input.value = "";
  }

  function handleRestore(e: Event) {
    const input = e.target as HTMLInputElement;
    for (const file of Array.from(input.files ?? [])) {
      const target = restoreTarget(file);
      if (target) {
        send(file, target.id);
      } else if (target === null) {
        addUploadError(file.name, "does not match any missing asset");
      } else {
        addUploadError(file.name, "matches more than one missing asset — delete the duplicates first");
      }
    }
    input.value = "";
  }

  async function handleDelete(asset: AssetSummary) {
    // Both kinds of use are named: an element the researcher can fix in the
    // Inspector, and a content row they cannot see from here at all.
    const uses = usage.get(asset.id) ?? [];
    const warning = uses.length
      ? `${asset.fileName} is used by ${uses.map(describeAssetUse).join(", ")}. Each of those will show a missing source. Delete anyway?`
      : `Delete ${asset.fileName}?`;

    if (!confirm(warning)) return;

    try {
      await deleteAsset(asset.id);
      await refresh();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : "Delete failed";
    }
  }
</script>

<div class="media-tab">
  <section>
    <div class="head">
      <h3>Media</h3>
      <label class="btn-primary">
        + Upload files
        <input type="file" accept="image/*,video/*,audio/*" multiple hidden onchange={handleUpload} />
      </label>
    </div>
    <span class="section-hint">
      Images, video and audio this experiment presents. Pick them from an
      element's Source field in the Builder.
    </span>

    {#if errorMessage}
      <p class="error">{errorMessage}</p>
    {/if}
    {#if contentWarning}
      <p class="error">{contentWarning}</p>
    {/if}
    {#if uploadErrors.length > 0}
      <div class="error-list">
        <div class="error-list-head">
          <span>
            {uploadErrors.length}
            {uploadErrors.length === 1 ? "file" : "files"} could not be uploaded
          </span>
          <button class="btn" onclick={dismissUploadErrors}>Dismiss</button>
        </div>
        <ul>
          {#each uploadErrors as failure}
            <li><strong>{failure.file}</strong>: {failure.message}</li>
          {/each}
        </ul>
      </div>
    {/if}
    {#if uploadingCount > 0}
      <p class="status">Uploading {uploadingCount} file(s)&hellip;</p>
    {/if}

    {#if loading}
      <p class="status">Loading&hellip;</p>
    {:else if assets.length === 0}
      <p class="status">No media yet.</p>
    {:else}
      <AssetGrid {assets} {usage} ondelete={handleDelete} />
    {/if}
  </section>

  {#if missing.length > 0}
    <section>
      <h3>Missing files</h3>
      <span class="section-hint">
        {missing.length} asset(s) came from an import without their files. Add
        them here — they are matched by filename.
      </span>
      <label class="btn-primary">
        Restore files
        <input type="file" accept="image/*,video/*,audio/*" multiple hidden onchange={handleRestore} />
      </label>
    </section>
  {/if}
</div>

<style>
  /* The tab container has no padding of its own: each tab supplies it, the way
     Settings, Content, Participants and Results do, so a full-bleed tab like the
     Builder or the session designer can still reach its own edges. */
  .media-tab { display: flex; flex-direction: column; gap: 24px; padding: 1.5rem; }
  .head { display: flex; align-items: center; justify-content: space-between; }
  .section-hint { font-size: 12px; color: var(--gray-400); display: block; margin-bottom: 12px; }
  .status { font-size: 12px; color: var(--gray-500); }
  .error { font-size: 12px; color: var(--danger); }
  .btn-primary {
    display: inline-block;
    background: var(--black);
    color: #fff;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 14px;
    cursor: pointer;
  }
  .error-list { border: 1px solid var(--danger); background: var(--danger-dim); border-radius: var(--radius-sm); padding: 0.5rem 0.75rem; }
  .error-list-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; font-size: 12px; color: var(--danger); font-weight: 500; }
  .error-list ul { margin: 0.35rem 0 0; padding-left: 1.1rem; }
  .error-list li { font-size: 12px; color: var(--danger); line-height: 1.6; }
  .error-list .btn { font-size: 11px; padding: 2px 6px; cursor: pointer; border: 1px solid var(--danger); border-radius: var(--radius-sm); background: #fff; color: var(--danger); }
</style>
