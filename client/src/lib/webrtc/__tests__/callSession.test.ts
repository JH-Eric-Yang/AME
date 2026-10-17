import { describe, it, expect, vi } from "vitest";
import { get } from "svelte/store";
import type { PeerCallbacks } from "../PeerManager";
import { createCallSession, type PeerMesh } from "../callSession";
import { EmptyPlan, type CallPlan } from "../callPlan";

interface FakeTrack { kind: string; enabled: boolean; stop: ReturnType<typeof vi.fn> }

function fakeStream(...kinds: string[]) {
  const tracks: FakeTrack[] = kinds.map((kind) => ({ kind, enabled: true, stop: vi.fn() }));
  return {
    tracks,
    stream: {
      getTracks: () => tracks,
      getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
      getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
    } as unknown as MediaStream,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup() {
  const meshes: Array<PeerMesh & { callbacks: PeerCallbacks; calls: Record<string, unknown[][]>; log: string[] }> = [];
  const media: Array<ReturnType<typeof deferred<MediaStream>>> = [];
  const getUserMedia = vi.fn((_constraints: MediaStreamConstraints) => {
    const next = deferred<MediaStream>();
    media.push(next);
    return next.promise;
  });
  const createMesh = vi.fn((callbacks: PeerCallbacks) => {
    const calls: Record<string, unknown[][]> = {};
    /** Every call's method name in order, so tests can compare call order across methods. */
    const log: string[] = [];
    const record = (name: string) => (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      log.push(name);
    };
    const mesh = {
      callbacks,
      calls,
      log,
      setLocalStream: record("setLocalStream"),
      clearLocalStream: record("clearLocalStream"),
      setPublishing: record("setPublishing"),
      setReceiveKinds: record("setReceiveKinds"),
      updatePeers: vi.fn(async (...args: unknown[]) => { record("updatePeers")(...args); }),
      resetConnections: record("resetConnections"),
      dispose: record("dispose"),
    };
    meshes.push(mesh as never);
    return mesh as unknown as PeerMesh;
  });
  const session = createCallSession({ createMesh, getUserMedia });
  return { session, meshes, media, getUserMedia, createMesh };
}

const av: CallPlan = { publish: { video: true, audio: true }, receive: ["video", "audio"], peers: ["p2"] };

describe("callSession", () => {
  it("builds the mesh before media lands, then hands it the stream and dials", async () => {
    const { session, meshes, media, getUserMedia } = setup();
    session.setPlan(av, "p1");

    expect(meshes).toHaveLength(1);
    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: true });
    expect(meshes[0].calls.updatePeers).toEqual([[["p2"], "p1"]]);

    const { stream } = fakeStream("video", "audio");
    media[0].resolve(stream);
    await session.settled();

    expect(meshes[0].calls.setLocalStream).toEqual([[stream]]);
    expect(meshes[0].calls.updatePeers).toHaveLength(2);
    expect(get(session).localStream).toBe(stream);
  });

  it("asks for exactly the published kinds", () => {
    const { session, getUserMedia } = setup();
    session.setPlan({ ...av, publish: { video: false, audio: true } }, "p1");
    expect(getUserMedia).toHaveBeenCalledWith({ video: false, audio: true });
  });

  it("an empty plan starts no media and no mesh", () => {
    const { session, createMesh, getUserMedia } = setup();
    session.setPlan(EmptyPlan, "p1");
    expect(createMesh).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("receives without media when the plan publishes nothing", () => {
    const { session, meshes, getUserMedia } = setup();
    session.setPlan({ publish: { video: false, audio: false }, receive: ["video"], peers: ["p2"] }, "p1");
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(meshes[0].calls.setPublishing).toEqual([[false]]);
    expect(meshes[0].calls.setReceiveKinds).toEqual([[["video"]]]);
    expect(meshes[0].calls.updatePeers).toEqual([[["p2"], "p1"]]);
  });

  it("stops a stream that lands after the call was stopped", async () => {
    const { session, meshes, media } = setup();
    session.setPlan(av, "p1");
    session.stop();

    const { stream, tracks } = fakeStream("video", "audio");
    media[0].resolve(stream);
    await session.settled();

    expect(tracks.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
    expect(meshes[0].calls.setLocalStream).toBeUndefined();
    expect(meshes[0].calls.dispose).toHaveLength(1);
    expect(get(session).localStream).toBeNull();
  });

  it("a rotation keeps the stream and re-dials", async () => {
    const { session, meshes, media, getUserMedia } = setup();
    session.setPlan(av, "p1");
    media[0].resolve(fakeStream("video", "audio").stream);
    await session.settled();

    session.setPlan({ ...av, peers: ["p3"] }, "p1");

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(meshes).toHaveLength(1);
    expect(meshes[0].calls.updatePeers.at(-1)).toEqual([["p3"], "p1"]);
  });

  it("an equal plan does nothing", async () => {
    const { session, meshes, media } = setup();
    session.setPlan(av, "p1");
    media[0].resolve(fakeStream("video", "audio").stream);
    await session.settled();
    const before = meshes[0].calls.updatePeers.length;

    session.setPlan({ ...av, receive: ["video", "audio"], peers: ["p2"] }, "p1");

    expect(meshes[0].calls.updatePeers).toHaveLength(before);
  });

  it("a publish change releases the old stream, resets the mesh and acquires again", async () => {
    const { session, meshes, media, getUserMedia } = setup();
    session.setPlan(av, "p1");
    const first = fakeStream("video", "audio");
    media[0].resolve(first.stream);
    await session.settled();

    session.setPlan({ ...av, publish: { video: false, audio: true } }, "p1");

    expect(first.tracks.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
    expect(meshes[0].calls.clearLocalStream).toHaveLength(1);
    expect(meshes[0].calls.resetConnections).toHaveLength(1);
    expect(getUserMedia).toHaveBeenLastCalledWith({ video: false, audio: true });
  });

  it("a release stops the old tracks and keeps receiving without media", async () => {
    const { session, meshes, media, getUserMedia } = setup();
    session.setPlan(av, "p1");
    const first = fakeStream("video", "audio");
    media[0].resolve(first.stream);
    await session.settled();

    session.setPlan({ ...av, publish: { video: false, audio: false } }, "p1");

    const { log, calls } = meshes[0];
    expect(first.tracks.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(calls.setPublishing.at(-1)).toEqual([false]);
    // The reset's disconnect callbacks re-dial; a mesh still marked publishing
    // would wait forever for media that is never coming.
    expect(log.lastIndexOf("setPublishing")).toBeLessThan(log.lastIndexOf("resetConnections"));
    expect(calls.resetConnections).toHaveLength(1);
    expect(calls.updatePeers.at(-1)).toEqual([["p2"], "p1"]);
    expect(get(session).localStream).toBeNull();
  });

  it("stops a stream that lands after a publish change superseded it", async () => {
    const { session, meshes, media } = setup();
    session.setPlan(av, "p1");
    session.setPlan({ ...av, publish: { video: false, audio: true } }, "p1");

    const stale = fakeStream("video", "audio");
    const fresh = fakeStream("audio");
    media[1].resolve(fresh.stream);
    media[0].resolve(stale.stream);
    await session.settled();

    expect(stale.tracks.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
    expect(fresh.tracks.every((t) => t.stop.mock.calls.length === 0)).toBe(true);
    expect(meshes[0].calls.setLocalStream).toEqual([[fresh.stream]]);
    expect(get(session).localStream).toBe(fresh.stream);
  });

  it("ignores callbacks from a disposed mesh", async () => {
    const { session, meshes } = setup();
    const receiveOnly: CallPlan = { publish: { video: false, audio: false }, receive: ["video"], peers: ["p2"] };
    session.setPlan(receiveOnly, "p1");
    session.stop();
    session.setPlan(receiveOnly, "p1");
    const dials = meshes[1].calls.updatePeers.length;

    meshes[0].callbacks.onRemoteStream("p2", fakeStream("video").stream);
    meshes[0].callbacks.onPeerDisconnected("p2");

    expect(get(session).remoteStreams.size).toBe(0);
    expect(meshes[1].calls.updatePeers).toHaveLength(dials);
  });

  it("reports blocked media", async () => {
    const { session, media } = setup();
    session.setPlan(av, "p1");
    media[0].reject(new Error("NotAllowedError"));
    await session.settled();
    expect(get(session).mediaBlocked).toBe(true);
  });

  it("tracks remote streams and re-dials a peer that dropped", async () => {
    const { session, meshes, media } = setup();
    session.setPlan(av, "p1");
    media[0].resolve(fakeStream("video", "audio").stream);
    await session.settled();
    const remote = fakeStream("video").stream;
    const partner = session.streamFor("p2", false);

    meshes[0].callbacks.onRemoteStream("p2", remote);
    expect(get(partner)).toBe(remote);

    const before = meshes[0].calls.updatePeers.length;
    meshes[0].callbacks.onPeerDisconnected("p2");
    expect(get(partner)).toBeNull();
    expect(meshes[0].calls.updatePeers.length).toBe(before + 1);
  });

  it("streamFor(self) is the local stream, and toggles flip its tracks", async () => {
    const { session, media } = setup();
    session.setPlan(av, "p1");
    const { stream, tracks } = fakeStream("video", "audio");
    media[0].resolve(stream);
    await session.settled();

    expect(get(session.streamFor("p1", true))).toBe(stream);
    session.toggleAudio();
    expect(tracks.find((t) => t.kind === "audio")!.enabled).toBe(false);
    expect(get(session).audioMuted).toBe(true);
    session.toggleVideo();
    expect(tracks.find((t) => t.kind === "video")!.enabled).toBe(false);
    expect(get(session).videoOff).toBe(true);
  });

  it("keeps mute while the call continues, and a stopped call's next session starts unmuted", async () => {
    const { session, media } = setup();
    session.setPlan(av, "p1");
    media[0].resolve(fakeStream("video", "audio").stream);
    await session.settled();
    session.toggleAudio();
    session.toggleVideo();

    session.setPlan({ ...av, peers: ["p3"] }, "p1");
    expect(get(session)).toMatchObject({ audioMuted: true, videoOff: true });

    session.stop();
    expect(get(session)).toMatchObject({ audioMuted: false, videoOff: false });

    session.setPlan(av, "p1");
    const next = fakeStream("video", "audio");
    media[1].resolve(next.stream);
    await session.settled();
    expect(next.tracks.every((t) => t.enabled)).toBe(true);
  });
});
