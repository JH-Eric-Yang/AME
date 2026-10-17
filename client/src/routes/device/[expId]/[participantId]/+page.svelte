<script lang="ts">
  import { iceServers, connectIceServers } from "$lib/webrtc/iceServers";
  import Logo from "$lib/components/Logo.svelte";
  import { page } from "$app/stores";
  import { onMount, onDestroy } from "svelte";
  import { io, type Socket } from "socket.io-client";
  import type { ClientToServerEvents, ServerToClientEvents, ElementConfig } from "ame-shared";
  import DeviceCamera from "$lib/components/device/DeviceCamera.svelte";
  import DeviceScreen from "$lib/components/device/DeviceScreen.svelte";
  import { sendIntentsTo } from "$lib/elements/fireEvents";
  import { deviceServerUrl } from "$lib/config";

  type TypedClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

  const experimentId = $derived($page.params.expId!);
  const participantId = $derived($page.params.participantId!);
  const elementName = $derived($page.url.searchParams.get("element"));

  let socket: TypedClientSocket | null = $state(null);
  let connected = $state(false);
  let mode = $state<"camera" | "controller" | "slot-select" | "microphone" | null>(null);
  let elements = $state<ElementConfig[]>([]);
  let deviceProgress = $state(0);

  // Slot selection state
  let availableSlots = $state<{ slotLabel: string; capabilities: string[]; facingMode?: string }[]>([]);
  let selectedSlot = $state<{ slotLabel: string; capabilities: ("camera" | "microphone")[]; facingMode?: string; constraints?: Record<string, unknown> } | null>(null);

  /** Rises on every slot confirmation, so the camera reconnects on each step that records it. */
  let pairing = $state(0);
  /** The study ended: the camera and microphone are off and the phone only says so. */
  let finished = $state(false);

  // Text instruction overlay
  let instructionMessage = $state("");
  let instructionTimer: ReturnType<typeof setTimeout> | null = null;

  const InstructionDismissMs = 8000;

  onMount(() => {
    const serverUrl = deviceServerUrl(window.location.origin);
    socket = io(`${serverUrl}/experimentSocket`, {
      transports: ["websocket"],
    }) as TypedClientSocket;

    socket.on("connect", () => {
      connected = true;

      if (elementName) {
        // Multi-capture mode: start with slot selection
        mode = "slot-select";
        socket!.emit("device:connect", { participantId, mode: "camera", element: elementName });
      } else {
        // Legacy mode
        const urlMode = $page.url.searchParams.get("mode") as "camera" | "controller" | null;
        mode = urlMode ?? "camera";
        socket!.emit("device:connect", { participantId, mode: mode as "camera" | "controller" });
      }
    });

    // The server sends the TURN password once this phone pairs to a real participant.
    socket.on("ice:servers", connectIceServers(() => socket?.emit("ice:refresh")));

    socket.on("device:finished", () => {
      finished = true;
      micStream?.getTracks().forEach((t) => t.stop());
      micPc?.close();
      wakeLock?.release();
    });

    socket.on("device:content", (payload) => {
      elements = payload.elements;
      deviceProgress = payload.progress;
    });

    // Everything rendered here reports its intent to the desktop rather than
    // recording: that page owns the experiment's state.
    sendIntentsTo((element, trigger, value) => {
      socket?.emit("device:input", {
        elementName: element.name,
        trigger,
        value,
        progress: deviceProgress,
      });
    });

    // Receive available slots from server after device:connect
    socket.on("device:slots-available", (payload: { slots: typeof availableSlots }) => {
      availableSlots = payload.slots;
    });

    socket.on("device:slot-confirmed", (payload) => {
      selectedSlot = payload;
      const hasCamera = payload.capabilities.includes("camera");
      mode = hasCamera ? "camera" : "microphone";
      pairing += 1;
      // A later step: the microphone is open already, so only the connection is new.
      if (micStream) setupMicWebRTC(micStream);
      requestWakeLock();
    });

    // The desktop's answer and ICE for the microphone; a signal for another phone of this participant is not ours.
    socket.on("device:signal", async (signal) => {
      if (!micPc || signal.deviceId !== socket?.id) return;
      if (signal.sdp) {
        await micPc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      } else {
        micPc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {});
      }
    });

    socket.on("device:slot-denied", ({ reason }) => {
      // Show error, stay on slot selection
      console.warn("Slot denied:", reason);
    });

    socket.on("device:text-instruction", ({ message, target }) => {
      // If target is set and doesn't match our slot label, ignore
      if (target && target !== "all" && selectedSlot && target !== selectedSlot.slotLabel) return;
      instructionMessage = message;
      if (instructionTimer) clearTimeout(instructionTimer);
      instructionTimer = setTimeout(() => { instructionMessage = ""; }, InstructionDismissMs);
    });

    socket.on("disconnect", () => {
      connected = false;
    });
  });

  // Request Wake Lock to prevent screen from sleeping during capture
  let wakeLock: WakeLockSentinel | null = null;
  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        wakeLock = await navigator.wakeLock.request("screen");
      }
    } catch {
      // Wake Lock not supported or denied — best effort
    }
  }

  onDestroy(() => {
    sendIntentsTo(null);
    socket?.disconnect();
    wakeLock?.release();
    if (instructionTimer) clearTimeout(instructionTimer);
    micStream?.getTracks().forEach((t) => t.stop());
    micPc?.close();
  });


  // Acquire mic stream with echoCancellation when entering microphone mode
  let micStream: MediaStream | null = null;
  let micPc: RTCPeerConnection | null = null;

  function setupMicWebRTC(stream: MediaStream) {
    if (!socket) return;

    micPc?.close();
    const connection = new RTCPeerConnection({ iceServers: iceServers() });
    micPc = connection;

    // Add audio tracks
    for (const track of stream.getAudioTracks()) {
      connection.addTrack(track, stream);
    }

    connection.onicecandidate = (event) => {
      if (event.candidate) {
        socket!.emit("device:signal", { candidate: event.candidate.toJSON() });
      }
    };

    // Create and send offer
    connection.createOffer().then(async (offer) => {
      await connection.setLocalDescription(offer);
      socket!.emit("device:signal", { sdp: { type: "offer", sdp: offer.sdp } });
    });
  }

  $effect(() => {
    if (mode === "microphone" && !micStream) {
      navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      }).then((stream) => {
        micStream = stream;
        setupMicWebRTC(stream);
      }).catch(() => {
        // Mic permission denied
      });
    }
  });

  function claimSlot(slotLabel: string) {
    if (!elementName) return;
    socket?.emit("device:slot-claim", { slotLabel, elementName });
  }

  function dismissInstruction() {
    instructionMessage = "";
    if (instructionTimer) clearTimeout(instructionTimer);
  }
</script>

<div class="device-page">
  {#if finished}
    <div class="center">
      <p>The study is complete. You can close this page.</p>
    </div>
  {:else if !connected}
    <div class="center">
      <p>Connecting to experiment...</p>
    </div>
  {:else if mode === "slot-select"}
    <div class="slot-select">
      <div class="slot-header">
        <div class="slot-logo"><Logo size={28} /></div>
        <div class="slot-title">Choose Device Role</div>
        <div class="slot-subtitle">What will this device be used for?</div>
      </div>
      {#each availableSlots as slot}
        <button class="slot-option" onclick={() => claimSlot(slot.slotLabel)}>
          <span class="slot-icon">{slot.capabilities.includes("camera") ? "📷" : "🎤"}</span>
          <span class="slot-label">{slot.slotLabel}</span>
          <span class="slot-caps">{slot.capabilities.join(" + ")}</span>
        </button>
      {/each}
    </div>
  {:else if mode === "camera"}
    <DeviceCamera {socket} {pairing} facingMode={(selectedSlot?.facingMode as "user" | "environment") ?? "environment"} />
  {:else if mode === "microphone"}
    <div class="mic-mode">
      <div class="mic-icon">🎤</div>
      <div class="mic-label">{selectedSlot?.slotLabel ?? "Microphone"}</div>
      <div class="mic-status">Connected</div>
      <div class="mic-hint">Keep this device near the participant.<br>Do not lock the screen.</div>
    </div>
  {:else if mode === "controller"}
    <DeviceScreen {elements} />
  {:else}
    <div class="center">
      <p>Unknown device mode.</p>
    </div>
  {/if}

  <!-- Text instruction overlay -->
  {#if instructionMessage}
    <button class="instruction-overlay" onclick={dismissInstruction}>
      <span class="instruction-text">💬 {instructionMessage}</span>
    </button>
  {/if}
</div>

<style>
  .device-page { min-height: 100vh; background: var(--black); color: var(--white); position: relative; }
  .center { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .center p { font-size: 14px; color: var(--gray-400); }
  .slot-select { padding: 2rem 1rem; text-align: center; }
  .slot-header { margin-bottom: 2rem; }
  /* The page is dark, so the mark sits on a light tile to keep its black body visible. */
  .slot-logo { display: inline-flex; padding: 8px; margin-bottom: 0.75rem; background: var(--white); border-radius: var(--radius); }
  .slot-option:hover { border-color: var(--white); }
  .slot-title { font-size: 16px; font-weight: 600; }
  .slot-subtitle { font-size: 12px; color: var(--gray-400); margin-top: 0.25rem; }
  .slot-option {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    max-width: 280px;
    margin: 0 auto 0.75rem;
    padding: 1rem;
    border: 1px solid var(--gray-600);
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--white);
    cursor: pointer;
    font-size: 14px;
  }
  .slot-icon { font-size: 28px; }
  .slot-label { font-weight: 500; }
  .slot-caps { font-size: 11px; color: var(--gray-400); }
  .mic-mode {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    gap: 0.75rem;
  }
  .mic-icon { font-size: 48px; }
  .mic-label { font-size: 16px; font-weight: 600; }
  .mic-status { font-size: 12px; color: var(--success); }
  .mic-hint { font-size: 11px; color: var(--gray-500); text-align: center; margin-top: 1.5rem; line-height: 1.6; }
  .instruction-overlay {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0,0,0,0.85);
    border: 1px solid var(--gray-600);
    border-radius: var(--radius-lg);
    padding: 1rem 1.5rem;
    max-width: 80vw;
    z-index: 100;
    cursor: pointer;
    color: var(--white);
    font-size: 14px;
  }
  .instruction-text { line-height: 1.5; }
</style>
