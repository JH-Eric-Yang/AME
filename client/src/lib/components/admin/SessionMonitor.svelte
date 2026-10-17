<script lang="ts">
  import { iceServers } from "$lib/webrtc/iceServers";
  import { onMount, onDestroy } from "svelte";
  import type { Socket } from "socket.io-client";
  import type { ClientToServerEvents, ServerToClientEvents } from "ame-shared";

  type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

  let {
    socket,
    participantId,
  }: {
    socket: TypedSocket;
    participantId: string;
  } = $props();

  let streams = $state<Map<string, MediaStream>>(new Map());
  let instructionTarget = $state("all");
  let instructionText = $state("");

  // WebRTC for receiving streams from desktop
  let monitorPc: RTCPeerConnection | null = null;

  onMount(() => {
    socket.emit("monitor:subscribe", { participantId });

    socket.on("monitor:signal:offer", async ({ fromParticipantId, sdp }) => {
      monitorPc = new RTCPeerConnection({ iceServers: iceServers() });

      monitorPc.ontrack = (event) => {
        // Each track arrives as a separate stream
        const streamId = event.streams[0]?.id ?? event.track.id;
        const existing = streams.get(streamId) ?? new MediaStream();
        existing.addTrack(event.track);
        streams = new Map(streams).set(streamId, existing);
      };

      monitorPc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("monitor:signal:ice", {
            participantId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      await monitorPc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await monitorPc.createAnswer();
      await monitorPc.setLocalDescription(answer);
      socket.emit("monitor:signal:answer", {
        participantId,
        sdp: { type: "answer", sdp: answer.sdp },
      });
    });

    socket.on("monitor:signal:ice", ({ fromParticipantId, candidate }) => {
      monitorPc?.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
    });
  });

  onDestroy(() => {
    monitorPc?.close();
  });

  // Svelte action to bind MediaStream to video element
  function setVideoStream(node: HTMLVideoElement, stream: MediaStream) {
    node.srcObject = stream;
    return {
      update(newStream: MediaStream) { node.srcObject = newStream; },
      destroy() { node.srcObject = null; },
    };
  }

  function sendInstruction() {
    if (!instructionText.trim()) return;
    socket.emit("monitor:text-instruction", {
      participantId,
      target: instructionTarget,
      message: instructionText.trim(),
    });
    instructionText = "";
  }
</script>

<div class="session-monitor">
  <div class="monitor-header">
    <span class="monitor-title">Participant {participantId.slice(0, 8)}</span>
  </div>

  <div class="stream-grid">
    {#each [...streams.entries()] as [id, s]}
      <div class="stream-card">
        <video
          autoplay
          muted
          playsinline
          use:setVideoStream={s}
        ></video>
      </div>
    {/each}
  </div>

  <div class="instruction-bar">
    <select bind:value={instructionTarget}>
      <option value="all">All devices</option>
    </select>
    <input
      type="text"
      bind:value={instructionText}
      placeholder="Type instruction..."
      onkeydown={(e) => { if (e.key === "Enter") sendInstruction(); }}
    />
    <button onclick={sendInstruction}>Send</button>
  </div>
</div>

<style>
  .session-monitor { border: 1px solid var(--gray-200); border-radius: 8px; overflow: hidden; }
  .monitor-header { padding: 0.75rem; border-bottom: 1px solid var(--gray-200); }
  .monitor-title { font-size: 14px; font-weight: 600; }
  .stream-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.5rem; padding: 0.75rem; }
  .stream-card { aspect-ratio: 4/3; background: var(--black); border-radius: var(--radius-sm); overflow: hidden; }
  .stream-card video { width: 100%; height: 100%; object-fit: cover; }
  .instruction-bar { display: flex; gap: 0.5rem; padding: 0.75rem; border-top: 1px solid var(--gray-200); }
  .instruction-bar select { font-size: 12px; padding: 0.4rem; border: 1px solid var(--gray-300); border-radius: var(--radius-sm); }
  .instruction-bar input { flex: 1; font-size: 12px; padding: 0.4rem 0.6rem; border: 1px solid var(--gray-300); border-radius: var(--radius-sm); }
  .instruction-bar button { font-size: 12px; background: var(--black); color: #fff; border: none; padding: 0.4rem 0.8rem; border-radius: var(--radius-sm); cursor: pointer; }
</style>
