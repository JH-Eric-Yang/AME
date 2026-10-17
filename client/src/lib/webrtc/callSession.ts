/**
 * callSession — the one call a participant is in: local media, the peer mesh
 * and the streams it receives, driven by the CallPlan of whatever routine is on
 * screen (spec §6.2). Tiles subscribe to streams; they never own media.
 *
 * Carried over from RoutineVideoChat: the mesh is built BEFORE media is awaited
 * (its constructor registers the signalling listeners, and a peer that offers
 * while our permission prompt is open would otherwise be lost for good), and a
 * getUserMedia that resolves after a newer plan or a stop is discarded with its
 * tracks stopped, so the camera is never left on.
 */

import { derived, get, writable, type Readable } from "svelte/store";
import type { MediaChannel } from "ame-shared/videoChat";
import { PeerManager, type PeerCallbacks } from "./PeerManager";
import { mediaAction, samePlan, type CallPlan, type Publish } from "./callPlan";
import { reportClientError } from "$lib/errors/reporter";

export interface PeerMesh {
  setLocalStream(stream: MediaStream): void;
  clearLocalStream(): void;
  setPublishing(publishing: boolean): void;
  setReceiveKinds(kinds: readonly MediaChannel[]): void;
  updatePeers(desired: string[], selfId: string): Promise<void>;
  resetConnections(): void;
  dispose(): void;
}

export interface CallSessionDeps {
  createMesh(callbacks: PeerCallbacks): PeerMesh;
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
}

export interface CallSessionState {
  localStream: MediaStream | null;
  remoteStreams: ReadonlyMap<string, MediaStream>;
  mediaBlocked: boolean;
  audioMuted: boolean;
  videoOff: boolean;
}

export interface CallSession extends Readable<CallSessionState> {
  setPlan(plan: CallPlan, selfId: string): void;
  stop(): void;
  toggleAudio(): void;
  toggleVideo(): void;
  streamFor(participantId: string | null, self: boolean): Readable<MediaStream | null>;
  /** Resolves once any in-flight getUserMedia has settled. For tests. */
  settled(): Promise<void>;
}

const InitialState: CallSessionState = {
  localStream: null,
  remoteStreams: new Map(),
  mediaBlocked: false,
  audioMuted: false,
  videoOff: false,
};

const stopTracks = (stream: MediaStream) => stream.getTracks().forEach((track) => track.stop());

export function createCallSession(deps: CallSessionDeps): CallSession {
  const store = writable<CallSessionState>({ ...InitialState, remoteStreams: new Map() });
  let mesh: PeerMesh | null = null;
  let current: { plan: CallPlan; selfId: string } | null = null;
  /** What the live (or in-flight) local stream publishes. */
  let acquired: Publish | null = null;
  /** Bumped on every acquire and release; a getUserMedia from an older generation is discarded. */
  let generation = 0;
  /** Every acquisition still in flight, so settled() waits for the latest as well as the stale ones. */
  let pending: Promise<void> = Promise.resolve();

  function reconcile() {
    if (!mesh || !current) return;
    mesh.updatePeers(current.plan.peers, current.selfId).catch((err) => {
      // Offer/answer failure is non-fatal: the next plan or drop re-diffs from scratch.
      reportClientError(err, { kind: "updatePeers" });
    });
  }

  function buildMesh(): PeerMesh {
    const owner: PeerMesh = deps.createMesh({
      onRemoteStream: (peerId, stream) => {
        if (mesh !== owner) return;
        store.update((s) => ({ ...s, remoteStreams: new Map(s.remoteStreams).set(peerId, stream) }));
      },
      onPeerDisconnected: (peerId) => {
        if (mesh !== owner) return;
        store.update((s) => {
          const remoteStreams = new Map(s.remoteStreams);
          remoteStreams.delete(peerId);
          return { ...s, remoteStreams };
        });
        // A peer that FAILED is still planned and must be re-dialled; a stale
        // one closed by updatePeers diffs to a no-op.
        reconcile();
      },
    });
    return owner;
  }

  function releaseMedia() {
    generation += 1;
    acquired = null;
    const { localStream } = get(store);
    if (localStream) stopTracks(localStream);
    mesh?.clearLocalStream();
    store.update((s) => ({ ...s, localStream: null, mediaBlocked: false }));
  }

  function acquire(publish: Publish) {
    const mine = ++generation;
    acquired = publish;
    const attempt = deps
      .getUserMedia({ video: publish.video, audio: publish.audio })
      .then((stream) => {
        if (mine !== generation) {
          stopTracks(stream);
          return;
        }
        const { audioMuted, videoOff } = get(store);
        stream.getAudioTracks().forEach((track) => {
          track.enabled = !audioMuted;
        });
        stream.getVideoTracks().forEach((track) => {
          track.enabled = !videoOff;
        });
        mesh?.setLocalStream(stream);
        store.update((s) => ({ ...s, localStream: stream, mediaBlocked: false }));
        reconcile();
      })
      .catch((err) => {
        // Permission denied or no device. `acquired` stays set so an equal plan
        // does not re-prompt; the participant is told to fix permissions and reload.
        reportClientError(err, { kind: "getUserMedia" });
        if (mine === generation) store.update((s) => ({ ...s, mediaBlocked: true }));
      });
    pending = Promise.all([pending, attempt]).then(() => undefined);
  }

  function stop() {
    releaseMedia();
    current = null;
    const closing = mesh;
    mesh = null;
    closing?.dispose();
    // Mute and camera-off carry between routines that keep the call, which never
    // stop it. A new call starts unmuted, or a recordLocal recording captures silence.
    store.update((s) => ({ ...s, remoteStreams: new Map(), audioMuted: false, videoOff: false }));
  }

  function setPlan(plan: CallPlan, selfId: string) {
    if (current && current.selfId === selfId && samePlan(current.plan, plan)) return;
    const publishing = plan.publish.video || plan.publish.audio;
    if (!publishing && plan.peers.length === 0) {
      stop();
      return;
    }

    current = { plan, selfId };
    mesh ??= buildMesh();
    mesh.setPublishing(publishing);
    mesh.setReceiveKinds(plan.receive);

    const action = mediaAction(acquired, plan.publish);
    if (action === "release" || action === "replace") {
      releaseMedia();
      mesh.resetConnections();
    }
    if (action === "acquire" || action === "replace") acquire(plan.publish);
    reconcile();
  }

  function toggle(kind: MediaChannel) {
    store.update((s) => {
      const off = kind === "audio" ? !s.audioMuted : !s.videoOff;
      const tracks = kind === "audio" ? s.localStream?.getAudioTracks() : s.localStream?.getVideoTracks();
      tracks?.forEach((track) => {
        track.enabled = !off;
      });
      return kind === "audio" ? { ...s, audioMuted: off } : { ...s, videoOff: off };
    });
  }

  return {
    subscribe: store.subscribe,
    setPlan,
    stop,
    toggleAudio: () => toggle("audio"),
    toggleVideo: () => toggle("video"),
    streamFor: (participantId, self) =>
      derived(store, (s) => (self ? s.localStream : participantId ? (s.remoteStreams.get(participantId) ?? null) : null)),
    settled: () => pending,
  };
}

export const callSession = createCallSession({
  createMesh: (callbacks) => new PeerManager(callbacks),
  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
});
