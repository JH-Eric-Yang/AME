<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { get } from "svelte/store";
  import type { MediaChannel } from "ame-shared/videoChat";
  import { runner } from "$lib/stores/runner";
  import { callSession } from "$lib/webrtc/callSession";
  import { recordingKinds, type ResolvedTile } from "$lib/webrtc/callPlan";
  import { RecordingManager } from "$lib/recording/RecordingManager";

  /**
   * Records one tile's listed media channels and uploads them under the tile's
   * element name for the VIEWER (spec §6.1). The parent keys this component per
   * delivery, so a new progress or a new partner starts a new recording.
   */
  let { tile }: { tile: ResolvedTile } = $props();

  /** How often the grace period is re-checked while waiting for tracks. */
  const ReadinessPollMs = 1000;
  const LiveTrack = "live";

  const participantId = $derived(tile.participantId);
  const self = $derived(tile.self);
  const stream = $derived(callSession.streamFor(participantId, self));

  const mountedAt = Date.now();
  let now = $state(mountedAt);
  const poll = setInterval(() => { now = Date.now(); }, ReadinessPollMs);

  let manager: RecordingManager | null = null;
  let started = false;
  let destroyed = false;

  $effect(() => {
    const current = $stream;
    const waited = now - mountedAt;
    if (started || destroyed || !current || $runner.proceedRequested) return;
    const available = current
      .getTracks()
      .filter((track) => track.readyState === LiveTrack)
      .map((track) => track.kind as MediaChannel);
    const kinds = recordingKinds(tile.media, available, waited);
    if (!kinds) return;
    started = true;
    clearInterval(poll);
    // A stream of just the listed kinds: an ["audio"] tile must not record video.
    const recorded = new MediaStream(current.getTracks().filter((track) => kinds.includes(track.kind as MediaChannel)));
    untrack(() => start(recorded));
  });

  $effect(() => {
    if ($runner.proceedRequested && started) manager?.stop();
  });

  /**
   * Identifies this instance's entry in `pendingUploads`. The {#key} remount
   * registers a successor under the same element name while this instance's
   * upload may still be running; the token keeps the old upload from marking
   * the new entry complete or overwriting its response.
   */
  const instanceToken = crypto.randomUUID();

  const ownsEntry = (name: string): boolean => get(runner).pendingUploads.get(name)?.uploadId === instanceToken;

  function start(recorded: MediaStream) {
    const { experimentId, participantId: viewerId, progress, trial } = get(runner);
    const name = tile.name;
    try {
      const recorder = new RecordingManager(recorded, {
        uploadMode: "on-stop",
        experimentId,
        participantId: viewerId,
        progress,
        trial,
        elementName: name,
      });
      // The upload itself always completes (the recording is data); only the
      // runner bookkeeping is skipped once a successor owns the entry.
      recorder.onUploadComplete = () => {
        if (!ownsEntry(name)) return;
        runner.updateUpload(name, { status: "complete", progress: 100 });
        runner.setResponse(name, recorder.getResponse());
      };
      recorder.onUploadFailed = () => {
        if (ownsEntry(name)) runner.updateUpload(name, { status: "failed" });
      };
      runner.registerUpload(name, instanceToken);
      manager = recorder;
      recorder.start();
    } catch (error) {
      console.error(`[TileRecorder] Failed to start recording for ${name}:`, error);
      // Never leave an "uploading" entry behind: it would block Proceed for the routine.
      if (ownsEntry(name)) runner.updateUpload(name, { status: "failed" });
      manager = null;
    }
  }

  onDestroy(() => {
    destroyed = true;
    clearInterval(poll);
    // Stops the recorder, which uploads what was captured. The tracks belong to
    // the call session and are not stopped here.
    manager?.dispose();
  });
</script>
