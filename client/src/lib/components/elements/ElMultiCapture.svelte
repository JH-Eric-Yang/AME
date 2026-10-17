<script lang="ts">
  import { iceServers } from "$lib/webrtc/iceServers";
  import { onMount, onDestroy } from "svelte";
  import QRCode from "qrcode";
  import type { ElementConfig, MultiCaptureParams, DeviceSignal, DeviceSource } from "ame-shared";
  import { runner } from "$lib/stores/runner";
  import { getSocket } from "$lib/socket/experimentSocket";
  import { RecordingManager, type RecordingConfig } from "$lib/recording/RecordingManager";
  import DeviceSlot from "./DeviceSlot.svelte";
  import { multiCaptureView } from "$lib/elements/multiCaptureView";

  let { element }: { element: ElementConfig } = $props();
  const p = $derived(element.params as MultiCaptureParams);

  // WebRTC: one peer connection per device
  let devicePeers = new Map<string, RTCPeerConnection>();

  // Monitor peer connection — relays all streams to experimenter
  let monitorPc: RTCPeerConnection | null = null;

  async function setupMonitorPeer(experimenterId: string) {
    monitorPc = new RTCPeerConnection({ iceServers: iceServers() });

    monitorPc.onicecandidate = (event) => {
      if (event.candidate) {
        getSocket()?.emit("monitor:signal:ice", {
          participantId: experimenterId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    // Add all device streams + desktop stream as tracks
    for (const [, stream] of slotStreams) {
      for (const track of stream.getTracks()) {
        monitorPc.addTrack(track, stream);
      }
    }

    // Create and send offer to experimenter
    const offer = await monitorPc.createOffer();
    await monitorPc.setLocalDescription(offer);
    getSocket()?.emit("monitor:signal:offer", {
      participantId: experimenterId,
      sdp: { type: "offer", sdp: offer.sdp },
    });
  }

  function setupDevicePeer(deviceId: string, slotLabel: string) {
    const pc = new RTCPeerConnection({ iceServers: iceServers() });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        getSocket()?.emit("device:signal", { deviceId, candidate: event.candidate.toJSON() });
      }
    };

    pc.ontrack = (event) => {
      // Merge tracks into a single MediaStream per slot
      const existing = slotStreams.get(slotLabel);
      if (existing) {
        existing.addTrack(event.track);
        slotStreams = new Map(slotStreams); // trigger reactivity
      } else {
        const stream = new MediaStream();
        stream.addTrack(event.track);
        slotStreams = new Map(slotStreams).set(slotLabel, stream);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        slotStatuses = new Map(slotStatuses).set(slotLabel, "disconnected");
      }
    };

    devicePeers.set(deviceId, pc);
    return pc;
  }

  // State
  let qrDataUrl = $state("");
  let slotStatuses = $state<Map<string, "waiting" | "connected" | "recording" | "disconnected">>(new Map());
  let slotStreams = $state<Map<string, MediaStream>>(new Map());
  let managers = $state<Map<string, RecordingManager>>(new Map());
  let desktopStream: MediaStream | null = $state(null);
  let recording = $state(false);
  let uploading = $state(false);
  let allConnected = $state(false);
  let uploadsDone = $state(false);
  let elapsed = $state(0);
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;

  // Check if all slots are connected
  $effect(() => {
    allConnected = [...slotStatuses.values()].every(
      (s) => s === "connected" || s === "recording",
    );
  });

  const view = $derived(multiCaptureView(p, allConnected));

  // Auto-stop when proceed is requested
  $effect(() => {
    if ($runner.proceedRequested && recording) {
      stopRecording();
    }
  });

  onMount(async () => {
    // Initialize slot statuses
    const initMap = new Map<string, "waiting" | "connected" | "recording" | "disconnected">();
    for (const source of p.sources) {
      initMap.set(source.label, "waiting");
    }
    if (p.includeDesktop) {
      initMap.set("desktop", "waiting");
    }
    slotStatuses = initMap;

    // Generate QR code
    const url = `${window.location.origin}/device/${$runner.experimentId}/${$runner.participantId}?element=${element.name}`;
    qrDataUrl = await QRCode.toDataURL(url, { width: 200, margin: 1 });

    // Initialize slots on server
    const socket = getSocket();
    if (socket) {
      socket.emit("device:slots-init", {
        elementName: element.name,
        sources: p.sources,
      });

      // Listen for device events
      socket.on("device:slot-filled", handleSlotFilled);
      socket.on("device:slot-lost", handleSlotLost);

      // Listen for experimenter monitor joining
      socket.on("monitor:peer-joined", ({ peerId }) => {
        setupMonitorPeer(peerId);
      });
      socket.on("monitor:signal:answer", ({ fromParticipantId, sdp }) => {
        if (monitorPc) {
          monitorPc.setRemoteDescription(new RTCSessionDescription(sdp));
        }
      });
      socket.on("monitor:signal:ice", ({ fromParticipantId, candidate }) => {
        monitorPc?.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      });

      // WebRTC signaling from the phones
      socket.on("device:signal", handleDeviceSignal);
    }

    // Acquire desktop stream if needed
    if (p.includeDesktop) {
      try {
        const constraints: MediaStreamConstraints =
          p.desktopMode === "audio"
            ? { audio: true }
            : { video: true, audio: true };
        desktopStream = await navigator.mediaDevices.getUserMedia(constraints);
        slotStreams = new Map(slotStreams).set("desktop", desktopStream);
        slotStatuses = new Map(slotStatuses).set("desktop", "connected");
      } catch {
        // Desktop camera not available
      }
    }

    if (p.autoStart) {
      // Auto-start: watch for all slots to connect, then start automatically
      const unsubscribe = $effect.root(() => {
        $effect(() => {
          if (view.startByItself && !recording) {
            startRecording();
            unsubscribe();
          }
        });
      });
    }
  });

  onDestroy(() => {
    stopRecording();
    desktopStream?.getTracks().forEach((t) => t.stop());
    const socket = getSocket();
    if (socket) {
      socket.off("device:slot-filled", handleSlotFilled);
      socket.off("device:slot-lost", handleSlotLost);
      socket.off("monitor:peer-joined");
      socket.off("monitor:signal:answer");
      socket.off("monitor:signal:ice");
      socket.off("device:signal", handleDeviceSignal);
    }
    if (elapsedTimer) clearInterval(elapsedTimer);
    for (const pc of devicePeers.values()) pc.close();
    monitorPc?.close();
  });

  /** A phone's offer or ICE. A phone that has not filled a slot here has no peer and is ignored. */
  async function handleDeviceSignal(signal: DeviceSignal & { deviceId: string }) {
    const pc = devicePeers.get(signal.deviceId);
    if (!pc) return;
    if (!signal.sdp) {
      pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {});
      return;
    }
    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    getSocket()?.emit("device:signal", { deviceId: signal.deviceId, sdp: { type: "answer", sdp: answer.sdp } });
  }

  function handleSlotFilled(payload: { slotLabel: string; deviceId: string }) {
    slotStatuses = new Map(slotStatuses).set(payload.slotLabel, "connected");
    setupDevicePeer(payload.deviceId, payload.slotLabel);
  }

  function handleSlotLost(payload: { slotLabel: string; reason: string }) {
    slotStatuses = new Map(slotStatuses).set(payload.slotLabel, "disconnected");
    // If recording, the RecordingManager for this slot will detect the ended track
    // and finalize its upload.
  }

  function startRecording() {
    if (recording) return;

    const baseConfig: Omit<RecordingConfig, "elementName"> = {
      uploadMode: p.uploadMode ?? "streaming",
      experimentId: $runner.experimentId,
      participantId: $runner.participantId,
      progress: $runner.progress,
      trial: $runner.trial,
    };

    const newManagers = new Map<string, RecordingManager>();

    // Create manager for each connected slot
    for (const [label, status] of slotStatuses) {
      if (status !== "connected") continue;
      const stream = slotStreams.get(label);
      if (!stream) continue;

      const elementName = `${element.name}__${label}`;
      const manager = new RecordingManager(stream, {
        ...baseConfig,
        elementName,
        maxDuration: p.maxDuration ?? undefined,
      });

      // Record the response before the upload counts as done: "done" releases a
      // waiting proceed, which sends the responses at once.
      manager.onStateChange = (state) => {
        if (state.uploadStatus === "complete") runner.setResponse(elementName, manager.getResponse());
        if (state.uploadStatus === "complete" || state.uploadStatus === "failed") {
          runner.updateUpload(elementName, {
            status: state.uploadStatus,
            progress: state.uploadProgress,
          });
          checkAllUploadsDone();
        }
      };
      manager.onUploadComplete = () => {
        runner.setResponse(elementName, manager.getResponse());
        runner.updateUpload(elementName, { status: "complete", progress: 100 });
        checkAllUploadsDone();
      };
      manager.onUploadFailed = () => {
        runner.updateUpload(elementName, { status: "failed" });
      };

      runner.registerUpload(elementName);
      newManagers.set(label, manager);
    }

    // Start all simultaneously
    for (const m of newManagers.values()) m.start();
    managers = newManagers;
    recording = true;

    // Update slot statuses
    const updated = new Map(slotStatuses);
    for (const label of newManagers.keys()) {
      updated.set(label, "recording");
    }
    slotStatuses = updated;

    // Start elapsed timer
    elapsed = 0;
    elapsedTimer = setInterval(() => { elapsed += 1; }, 1000);
  }

  function stopRecording() {
    for (const m of managers.values()) m.stop();
    recording = false;
    uploading = true;
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  }

  function checkAllUploadsDone() {
    const allDone = [...managers.values()].every(
      (m) => m.uploadStatus === "complete" || m.uploadStatus === "failed",
    );
    if (allDone) {
      uploading = false;
      uploadsDone = true;
    }
  }

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  // Desktop source config for DeviceSlot rendering
  const desktopSource: DeviceSource = {
    label: "desktop",
    capabilities: p.desktopMode === "audio" ? ["microphone"] : ["camera", "microphone"],
  };
</script>

<div class="el-multi-capture">
  {#if uploadsDone}
    <div class="upload-done">All recordings uploaded</div>
  {:else if uploading && !uploadsDone}
    <div class="uploading">Uploading recordings...</div>
  {:else if recording}
    <!-- Recording phase -->
    <div class="recording-phase">
      <div class="rec-header">
        <span class="rec-indicator"><span class="rec-dot"></span> REC</span>
        <span class="rec-time">{formatTime(elapsed)}</span>
      </div>

      <div class="slot-grid" style="grid-template-columns: repeat({Math.min(p.sources.length + (p.includeDesktop ? 1 : 0), 3)}, 1fr);">
        {#each p.sources as source}
          <DeviceSlot
            {source}
            status={slotStatuses.get(source.label) ?? "waiting"}
            stream={slotStreams.get(source.label) ?? null}
          />
        {/each}
        {#if p.includeDesktop}
          <DeviceSlot
            source={desktopSource}
            status={slotStatuses.get("desktop") ?? "waiting"}
            stream={slotStreams.get("desktop") ?? null}
          />
        {/if}
      </div>

      {#if view.showStop}
        <button class="btn-stop" onclick={stopRecording}>Stop Recording</button>
      {/if}
    </div>
  {:else}
    <!-- Setup phase -->
    <div class="setup">
      {#if view.showQrCode}
        <div class="header">
          <div class="title">Connect Your Devices</div>
          <div class="subtitle">Scan the QR code with each phone or tablet</div>
        </div>
      {/if}

      {#if qrDataUrl && view.showQrCode}
        <div class="qr-container">
          <img src={qrDataUrl} alt="Device pairing QR code" />
        </div>
      {/if}

      <div class="slot-grid" style="grid-template-columns: repeat({Math.min(p.sources.length + (p.includeDesktop ? 1 : 0), 3)}, 1fr);">
        {#each p.sources as source}
          <DeviceSlot
            {source}
            status={slotStatuses.get(source.label) ?? "waiting"}
            stream={slotStreams.get(source.label) ?? null}
          />
        {/each}
        {#if p.includeDesktop}
          <DeviceSlot
            source={desktopSource}
            status={slotStatuses.get("desktop") ?? "waiting"}
            stream={slotStreams.get("desktop") ?? null}
          />
        {/if}
      </div>

      {#if view.showStart}
        <button class="btn-start" onclick={startRecording}>Start Recording</button>
      {:else if view.paired}
        <div class="paired">All devices are connected.</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .el-multi-capture { text-align: center; }
  .setup, .recording-phase { max-width: 600px; margin: 0 auto; }
  .header { margin-bottom: 1rem; }
  .title { font-size: 16px; font-weight: 600; }
  .subtitle { font-size: 12px; color: var(--gray-500); margin-top: 0.25rem; }
  .qr-container {
    width: 160px;
    height: 160px;
    margin: 0 auto 1.5rem;
    border: 1px solid var(--gray-200);
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .qr-container img { width: 140px; height: 140px; }
  .slot-grid { display: grid; gap: 0.75rem; margin-bottom: 1rem; }
  .btn-start, .btn-stop {
    padding: 0.5rem 2rem;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 14px;
    cursor: pointer;
    color: #fff;
  }
  .btn-start { background: var(--black); }
  .btn-stop { background: var(--danger); }
  .rec-header {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  .rec-indicator { color: var(--danger); font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 0.35rem; }
  .rec-dot {
    width: 10px; height: 10px;
    background: var(--danger); border-radius: 50%;
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  .rec-time { font-size: 14px; font-family: monospace; color: var(--gray-700); }
  .upload-done { font-size: 13px; color: var(--gray-700); margin-top: 1rem; }
  .paired { font-size: 13px; color: var(--gray-700); margin-top: 1rem; }
  .uploading { font-size: 13px; color: var(--gray-500); margin-top: 1rem; }
</style>
