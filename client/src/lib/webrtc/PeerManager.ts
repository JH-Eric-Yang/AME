/**
 * PeerManager — manages RTCPeerConnection instances for a multi-peer mesh.
 * Creates offer/answer, handles ICE, adds/removes tracks.
 */

import type { MediaChannel } from "ame-shared/videoChat";
import { SignalingClient } from "./SignalingClient";
import { diffPeers } from "./peerDiff";
import { sdpFingerprint } from "./sdpFingerprint";
import { iceServers } from "./iceServers";

export interface PeerCallbacks {
  onRemoteStream: (peerId: string, stream: MediaStream) => void;
  onPeerDisconnected: (peerId: string) => void;
}

export class PeerManager {
  private peers = new Map<string, RTCPeerConnection>();
  private remoteStreams = new Map<string, MediaStream>();
  private localStream: MediaStream | null = null;
  /**
   * False when this participant's tiles publish nothing (a text-only self tile
   * watching a partner). Then there is no local media to wait for, and a
   * connection may open receive-only.
   */
  private publishing = true;
  /** Kinds a remote tile renders; see initiateConnection. */
  private receiveKinds: MediaChannel[] = [];
  /** The participant id from the latest updatePeers; decides who yields in glare. */
  private selfId: string | null = null;
  private signaling: SignalingClient;
  private callbacks: PeerCallbacks;
  /** True while updatePeers is reconciling; see the comment there. */
  private updating = false;
  /** The most recent reconcile requested while one was already in flight. */
  private queued: { desired: string[]; selfId: string } | null = null;
  /**
   * Peers that got local tracks while their connection was mid-negotiation.
   * They renegotiate as soon as the connection is stable again; otherwise an
   * answer built before the camera started stays receive-only and the far
   * side never sees this participant.
   */
  private renegotiateWhenStable = new Set<string>();

  constructor(callbacks: PeerCallbacks) {
    this.callbacks = callbacks;
    this.signaling = new SignalingClient({
      onOffer: (fromPeerId, sdp) => this.handleOffer(fromPeerId, sdp),
      onAnswer: (fromPeerId, sdp) => this.handleAnswer(fromPeerId, sdp),
      onIce: (fromPeerId, candidate) => this.handleIce(fromPeerId, candidate),
    });
  }

  setLocalStream(stream: MediaStream): void {
    this.localStream = stream;
    // Add tracks to existing peers
    for (const [peerId, pc] of this.peers) {
      let added = false;
      for (const track of stream.getTracks()) {
        const senders = pc.getSenders();
        const existing = senders.find((s) => s.track?.kind === track.kind);
        if (!existing) {
          pc.addTrack(track, stream);
          added = true;
        }
      }
      // addTrack alone sends nothing: a connection answered before media landed
      // must renegotiate or the far tile stays black. A pc mid-negotiation
      // (an answer still being built without the camera) cannot renegotiate
      // now, so it renegotiates when it is stable again (onsignalingstatechange).
      if (added && pc.signalingState === "stable") {
        void this.renegotiate(peerId, pc);
      } else if (added) {
        this.renegotiateWhenStable.add(peerId);
      }
    }
  }

  private async renegotiate(peerId: string, pc: RTCPeerConnection): Promise<void> {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.signaling.sendOffer(peerId, { type: "offer", sdp: offer.sdp });
    } catch (err) {
      console.error(`[PeerManager] Failed to renegotiate with ${peerId}:`, err);
    }
  }

  setPublishing(publishing: boolean): void {
    this.publishing = publishing;
  }

  setReceiveKinds(kinds: readonly MediaChannel[]): void {
    this.receiveKinds = [...kinds];
  }

  /** Local media was released; a publishing mesh opens nothing until the next stream lands. */
  clearLocalStream(): void {
    this.localStream = null;
  }

  /**
   * Close every connection but keep listening for signals. Used when what this
   * participant publishes changes, so the next reconcile re-dials with the new
   * tracks instead of renegotiating live connections.
   */
  resetConnections(): void {
    for (const peerId of [...this.peers.keys()]) {
      this.closePeer(peerId);
    }
  }

  async initiateConnection(peerId: string): Promise<void> {
    const pc = this.createPeerConnection(peerId);
    this.peers.set(peerId, pc);

    // Add local tracks
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    // An answerer can only answer the m-lines it is offered, so ask for every
    // kind a tile here renders, even the ones this side does not send.
    const sending = new Set(this.localStream?.getTracks().map((track) => track.kind) ?? []);
    for (const kind of this.receiveKinds) {
      if (!sending.has(kind)) {
        pc.addTransceiver(kind, { direction: "recvonly" });
      }
    }

    // Create and send offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.signaling.sendOffer(peerId, { type: "offer", sdp: offer.sdp });
  }

  private async handleOffer(fromPeerId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    try {
      let pc = this.peers.get(fromPeerId);

      // A different fingerprint means the far side reset its connections and
      // dialled from a brand-new pc; the old one would reject the offer. Swap it
      // without a disconnect callback: the peer never left, the tile just waits
      // for the new tracks.
      const known = pc ? sdpFingerprint(pc.remoteDescription?.sdp) : null;
      if (pc && known !== null && known !== sdpFingerprint(sdp.sdp)) {
        this.replaceQuietly(fromPeerId, pc);
        pc = undefined;
      }

      // Glare: both sides offered at once. The higher id is polite and yields;
      // with no id known yet, yield too rather than risk both ignoring.
      if (pc && pc.signalingState === "have-local-offer") {
        const polite = this.selfId === null || this.selfId > fromPeerId;
        if (!polite) return;
        await pc.setLocalDescription({ type: "rollback" });
      }

      if (!pc) {
        pc = this.createPeerConnection(fromPeerId);
        this.peers.set(fromPeerId, pc);
      }

      // Add local tracks before setting remote description
      if (this.localStream) {
        for (const track of this.localStream.getTracks()) {
          const senders = pc.getSenders();
          const existing = senders.find((s) => s.track?.kind === track.kind);
          if (!existing) {
            pc.addTrack(track, this.localStream);
          }
        }
      }

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.signaling.sendAnswer(fromPeerId, { type: "answer", sdp: answer.sdp });
    } catch (err) {
      console.error(`[PeerManager] Failed to apply offer from ${fromPeerId}:`, err);
    }
  }

  private async handleAnswer(fromPeerId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    try {
      const pc = this.peers.get(fromPeerId);
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    } catch (err) {
      console.error(`[PeerManager] Failed to apply answer from ${fromPeerId}:`, err);
    }
  }

  /** Close and forget a connection without reporting the peer as disconnected. */
  private replaceQuietly(peerId: string, pc: RTCPeerConnection): void {
    pc.onconnectionstatechange = null;
    pc.ontrack = null;
    pc.onicecandidate = null;
    pc.close();
    this.peers.delete(peerId);
    this.renegotiateWhenStable.delete(peerId);
    this.remoteStreams.delete(peerId);
  }

  private handleIce(fromPeerId: string, candidate: RTCIceCandidateInit): void {
    const pc = this.peers.get(fromPeerId);
    if (!pc) return;
    pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {
      // ICE candidate error — non-fatal
    });
  }

  private createPeerConnection(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: iceServers() });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.sendIce(peerId, event.candidate.toJSON());
      }
    };

    pc.ontrack = (event) => {
      let stream = this.remoteStreams.get(peerId);
      if (!stream) {
        stream = new MediaStream();
        this.remoteStreams.set(peerId, stream);
      }
      stream.addTrack(event.track);
      this.callbacks.onRemoteStream(peerId, stream);
    };

    pc.onsignalingstatechange = () => {
      if (pc.signalingState !== "stable" || this.peers.get(peerId) !== pc) return;
      if (this.renegotiateWhenStable.delete(peerId)) void this.renegotiate(peerId, pc);
    };

    pc.onconnectionstatechange = () => {
      // "disconnected" is frequently transient and self-recovers, so only a
      // terminal state counts. The maps are cleared BEFORE the callback so the
      // next diffPeers sees the peer as missing and re-dials it — leaving the
      // pc in this.peers would report it as unchanged forever and the partner's
      // tile would stay blank for the rest of the trial.
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        // Closed as well as forgotten: dropping the pc from the map without
        // closing it would keep its senders — and their references to the
        // local camera tracks — alive for the life of the page.
        pc.close();
        this.peers.delete(peerId);
        this.renegotiateWhenStable.delete(peerId);
        this.remoteStreams.delete(peerId);
        this.callbacks.onPeerDisconnected(peerId);
      }
    };

    return pc;
  }

  getRemoteStream(peerId: string): MediaStream | undefined {
    return this.remoteStreams.get(peerId);
  }

  getAllRemoteStreams(): Map<string, MediaStream> {
    return new Map(this.remoteStreams);
  }

  /**
   * Reconcile the live mesh with the peers this participant should now be
   * connected to. A peer present in both sets keeps its connection, so a
   * rotation never re-negotiates an ongoing call. The lower participant id
   * initiates, so exactly one offer is made per new pair.
   */
  async updatePeers(desired: string[], selfId: string): Promise<void> {
    // Serialized, latest-wins. The caller is a Svelte effect that reads the
    // whole runner store, so it re-runs on every unrelated write (tus upload
    // progress fires many times a second) while this body awaits an offer.
    // Two interleaved runs could close a peer the other had not opened yet and
    // then open it, leaving the participant connected to a partner the server
    // never assigned.
    this.selfId = selfId;
    if (this.updating) {
      this.queued = { desired, selfId };
      return;
    }
    this.updating = true;
    try {
      const targets = desired.filter((peerId) => peerId !== selfId);
      const { toOpen, toClose } = diffPeers([...this.peers.keys()], targets);

      for (const peerId of toClose) {
        this.closePeer(peerId);
      }

      // No local media yet: an offer built now would carry no tracks, and the
      // far end would show a permanently black tile with no error. Stale peers
      // are still closed above (so a rotation is never left holding a dead
      // partner); opening waits until setLocalStream lands and the caller
      // re-runs us. A mesh that publishes nothing has no media to wait for.
      if (this.publishing && !this.localStream) return;

      for (const peerId of toOpen) {
        if (selfId < peerId) {
          await this.initiateConnection(peerId);
        }
      }
    } finally {
      this.updating = false;
      const next = this.queued;
      this.queued = null;
      if (next) {
        await this.updatePeers(next.desired, next.selfId);
      }
    }
  }

  closePeer(peerId: string): void {
    const pc = this.peers.get(peerId);
    if (!pc) return;
    // Detached before close() so a late state change cannot report the peer
    // as disconnected a second time.
    pc.onconnectionstatechange = null;
    pc.close();
    this.peers.delete(peerId);
    this.renegotiateWhenStable.delete(peerId);
    this.remoteStreams.delete(peerId);
    this.callbacks.onPeerDisconnected(peerId);
  }

  dispose(): void {
    this.resetConnections();
    this.signaling.dispose();
  }
}
