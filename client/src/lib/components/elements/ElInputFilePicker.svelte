<script lang="ts">
  import type { ElementConfig, InputFilePickerParams } from "ame-shared";
  import { runner } from "$lib/stores/runner";
  import { startUpload } from "$lib/upload/tusClient";

  interface PickedFile {
    name: string;
    size: number;
    mimeType: string;
    status: "uploading" | "complete" | "failed";
    progress: number;
    url?: string;
  }

  const DefaultMaxSizeMb = 100;
  const BytesPerMb = 1024 * 1024;

  let { element }: { element: ElementConfig } = $props();
  const p = $derived(element.params as InputFilePickerParams);

  let files = $state<PickedFile[]>([]);
  let rejected = $state<string[]>([]);
  let input: HTMLInputElement | undefined = $state();

  /** Uploads register under a per-file key so the proceed gate waits for each. */
  function uploadKey(index: number): string {
    return `${element.name}:${index}`;
  }

  function recordResponse() {
    runner.setResponse(
      element.name,
      files.map((f) => ({
        name: f.name,
        size: f.size,
        mimeType: f.mimeType,
        status: f.status,
        url: f.url,
      })),
    );
  }

  function upload(file: File, index: number) {
    runner.registerUpload(uploadKey(index));

    startUpload({
      blob: file,
      experimentId: $runner.experimentId,
      participantId: $runner.participantId,
      progress: $runner.progress,
      trial: $runner.trial,
      elementName: element.name,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      timestamp: new Date().toISOString(),
      onProgress: (pct) => {
        files[index].progress = pct;
        runner.updateUpload(uploadKey(index), { progress: pct });
      },
      onSuccess: (url) => {
        files[index].status = "complete";
        files[index].progress = 100;
        files[index].url = url;
        runner.updateUpload(uploadKey(index), { status: "complete", progress: 100 });
        recordResponse();
      },
      onError: () => {
        files[index].status = "failed";
        runner.updateUpload(uploadKey(index), { status: "failed" });
        recordResponse();
      },
    });
  }

  function handleChange(event: Event) {
    const picked = Array.from((event.target as HTMLInputElement).files ?? []);
    if (picked.length === 0) return;

    const maxBytes = (p.maxSizeMb ?? DefaultMaxSizeMb) * BytesPerMb;
    const remaining = (p.maxFiles ?? (p.multiple ? Infinity : 1)) - files.length;

    rejected = [];
    const accepted: File[] = [];

    for (const file of picked) {
      if (file.size > maxBytes) {
        rejected.push(`${file.name} exceeds ${p.maxSizeMb ?? DefaultMaxSizeMb} MB`);
        continue;
      }
      if (accepted.length >= remaining) {
        rejected.push(`${file.name} skipped — file limit reached`);
        continue;
      }
      accepted.push(file);
    }

    for (const file of accepted) {
      const index = files.length;
      files.push({
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        status: "uploading",
        progress: 0,
      });
      upload(file, index);
    }

    recordResponse();
    if (input) input.value = "";
  }
</script>

<div class="el-file-picker">
  <label class="picker">
    <input
      bind:this={input}
      type="file"
      accept={p.accept}
      multiple={p.multiple ?? false}
      onchange={handleChange}
    />
    <span>{p.label ?? "Choose file"}</span>
  </label>

  {#if files.length > 0}
    <ul class="files">
      {#each files as file (file.name + file.size)}
        <li class="file" class:failed={file.status === "failed"}>
          <span class="name">{file.name}</span>
          <span class="status">
            {#if file.status === "uploading"}
              {file.progress}%
            {:else if file.status === "complete"}
              Uploaded
            {:else}
              Upload failed
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  {#each rejected as message}
    <p class="rejected">{message}</p>
  {/each}
</div>

<style>
  .el-file-picker {
    width: 100%;
  }
  .picker {
    display: inline-block;
    padding: 0.5rem 1rem;
    border: 1px solid var(--black);
    border-radius: var(--radius-sm);
    font-size: 14px;
    cursor: pointer;
  }
  .picker input {
    display: none;
  }
  .files {
    list-style: none;
    margin: 0.75rem 0 0;
    padding: 0;
  }
  .file {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.375rem 0;
    font-size: 13px;
    border-bottom: 1px solid var(--gray-100);
  }
  .file.failed .status {
    color: var(--danger);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .status {
    color: var(--gray-500);
    white-space: nowrap;
  }
  .rejected {
    margin: 0.5rem 0 0;
    font-size: 13px;
    color: var(--danger);
  }
</style>
