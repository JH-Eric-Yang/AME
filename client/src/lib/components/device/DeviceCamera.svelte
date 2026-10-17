<script lang="ts">
  import { iceServers } from "$lib/webrtc/iceServers";
  import { onMount, onDestroy, untrack } from "svelte";
  import type { Socket } from "socket.io-client";
  import type { ClientToServerEvents, DeviceSignal, ServerToClientEvents } from "ame-shared";

  type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

  let { socket, facingMode: initialFacingMode = "environment", pairing }: {
    socket: TypedSocket | null;
    facingMode?: "user" | "environment";
    /** Rises each time the server confirms this phone's slot: once per step that records it. */
    pairing: number;
  } = $props();


  let videoEl: HTMLVideoElement;
  let stream: MediaStream | null = $state(null);
  let facingMode = $state<"user" | "environment">(initialFacingMode);
  let streaming = $state(false);
  let sending = $state(false);
  let pc: RTCPeerConnection | null = null;

  onMount(() => {
    socket?.on("device:signal", handleSignal);
    startCamera();
  });

  onDestroy(() => {
    socket?.off("device:signal", handleSignal);
    stream?.getTracks().forEach((t) => t.stop());
    pc?.close();
  });

  // A new step that records this phone: keep the camera, open a new connection.
  $effect(() => {
    pairing;
    untrack(connect);
  });

  /** Offer this phone's stream to the desktop, replacing any earlier connection. */
  function connect() {
    if (!socket || !stream) return;

    pc?.close();
    const connection = new RTCPeerConnection({ iceServers: iceServers() });
    pc = connection;
    sending = false;

    for (const track of stream.getTracks()) {
      connection.addTrack(track, stream);
    }

    connection.onicecandidate = (event) => {
      if (event.candidate) {
        socket!.emit("device:signal", { candidate: event.candidate.toJSON() });
      }
    };

    connection.onconnectionstatechange = () => {
      if (pc === connection) sending = connection.connectionState === "connected";
    };

    connection.createOffer().then(async (offer) => {
      await connection.setLocalDescription(offer);
      socket!.emit("device:signal", { sdp: { type: "offer", sdp: offer.sdp } });
    });
  }

  /** The desktop's answer and ICE; a signal for another phone of this participant is not ours. */
  async function handleSignal(signal: DeviceSignal & { deviceId: string }) {
    if (!pc || signal.deviceId !== socket?.id) return;
    if (signal.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    } else {
      pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {});
    }
  }

  async function startCamera() {
    stream?.getTracks().forEach((t) => t.stop());
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode },
        audio: false,
      });
      if (videoEl) {
        videoEl.srcObject = stream;
      }
      streaming = true;
      connect();
    } catch {
      streaming = false;
    }
  }

  function switchCamera() {
    facingMode = facingMode === "user" ? "environment" : "user";
    startCamera();
  }
</script>

<div class="device-camera">
  <div class="video-container">
    <video bind:this={videoEl} autoplay muted playsinline></video>
  </div>

  <div class="controls">
    <button onclick={switchCamera}>Switch Camera</button>
    <span class="status">
      {#if !streaming}No camera{:else if sending}Sending video to the computer{:else}Waiting for the next recording{/if}
    </span>
  </div>
</div>

<style>
  .device-camera {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  .video-container {
    flex: 1;
    background: var(--black);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 0.75rem;
    background: var(--black);
  }
  button {
    background: var(--gray-700);
    color: #fff;
    border: 1px solid var(--gray-600);
    padding: 0.5rem 1rem;
    border-radius: var(--radius-sm);
    font-size: 14px;
    cursor: pointer;
  }
  .status { font-size: 12px; color: var(--gray-400); }
</style>
