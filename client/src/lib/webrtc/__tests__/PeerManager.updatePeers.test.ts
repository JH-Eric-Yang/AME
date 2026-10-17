import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { PeerManager } from "../PeerManager";

/** Minimal stand-in for RTCPeerConnection; node has no WebRTC. */
class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  onicecandidate: unknown = null;
  ontrack: unknown = null;
  onconnectionstatechange: (() => void) | null = null;
  onsignalingstatechange: (() => void) | null = null;
  closed = false;
  connectionState = "new";

  constructor() {
    FakePeerConnection.instances.push(this);
  }
  /** Drive the state machine the way the browser would. */
  enterState(state: string) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }
  signalingState = "stable";
  remoteDescription: { type: string; sdp?: string } | null = null;
  /** Every local description applied, in order ("offer", "answer", "rollback"). */
  localTypes: string[] = [];
  senders: Array<{ track: { kind: string } }> = [];
  getSenders() {
    return this.senders;
  }
  addTrack(track: { kind: string }) {
    this.senders.push({ track });
  }
  transceivers: Array<[string, string]> = [];
  addTransceiver(kind: string, init: { direction: string }) {
    this.transceivers.push([kind, init.direction]);
  }
  async createOffer() {
    return { type: "offer", sdp: "fake-sdp" };
  }
  async createAnswer() {
    return { type: "answer", sdp: "fake-answer" };
  }
  async setLocalDescription(description: { type: string }) {
    this.localTypes.push(description.type);
    this.setSignalingState(description.type === "offer" ? "have-local-offer" : "stable");
  }
  async setRemoteDescription(description: { type: string; sdp?: string }) {
    this.remoteDescription = description;
    this.setSignalingState(description.type === "offer" ? "have-remote-offer" : "stable");
  }
  /** The browser fires signalingstatechange only on a real change. */
  private setSignalingState(state: string) {
    if (state === this.signalingState) return;
    this.signalingState = state;
    this.onsignalingstatechange?.();
  }
  close() {
    this.closed = true;
  }
}

function createManager() {
  const disconnected: string[] = [];
  const manager = new PeerManager({
    onRemoteStream: () => {},
    onPeerDisconnected: (peerId) => disconnected.push(peerId),
  });
  return { manager, disconnected };
}

/**
 * getTracks() is all initiateConnection and setLocalStream touch. Tests above
 * the "without local media" describe exercise open/close diffing logic, which
 * requires local media to be present per the updatePeers guard — so they set
 * this before calling updatePeers.
 */
const FakeMediaStream = { getTracks: () => [] } as unknown as MediaStream;

describe("PeerManager.updatePeers", () => {
  afterEach(() => {
    FakePeerConnection.instances = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens a connection to each new peer with a higher id", async () => {
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    const { manager } = createManager();
    manager.setLocalStream(FakeMediaStream);

    await manager.updatePeers(["p3", "p2"], "p1");

    expect(FakePeerConnection.instances).toHaveLength(2);
  });

  it("keeps the shared peer and swaps only the stale one", async () => {
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    const { manager, disconnected } = createManager();
    manager.setLocalStream(FakeMediaStream);

    await manager.updatePeers(["p2", "p3"], "p1");
    const [toP2, toP3] = FakePeerConnection.instances;

    await manager.updatePeers(["p3", "p4"], "p1");

    expect(toP2.closed).toBe(true);
    expect(toP3.closed).toBe(false);
    expect(FakePeerConnection.instances).toHaveLength(3);
    expect(disconnected).toEqual(["p2"]);
  });

  it("waits for the offer when the peer id is lower than its own", async () => {
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    const { manager } = createManager();
    manager.setLocalStream(FakeMediaStream);

    await manager.updatePeers(["p1"], "p9");

    expect(FakePeerConnection.instances).toHaveLength(0);
  });

  it("never connects to itself", async () => {
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    const { manager } = createManager();
    manager.setLocalStream(FakeMediaStream);

    await manager.updatePeers(["p1", "p2"], "p1");

    expect(FakePeerConnection.instances).toHaveLength(1);
  });

  it("fires onPeerDisconnected so the stale tile clears", async () => {
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    const { manager, disconnected } = createManager();
    manager.setLocalStream(FakeMediaStream);

    await manager.updatePeers(["p2"], "p1");
    manager.closePeer("p2");

    expect(disconnected).toEqual(["p2"]);
  });

  describe("connection state changes", () => {
    it("ignores a transient disconnected state", async () => {
      // "disconnected" self-recovers far more often than not; treating it as
      // terminal blanks the partner for the rest of the trial.
      vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
      const { manager, disconnected } = createManager();
      manager.setLocalStream(FakeMediaStream);

      await manager.updatePeers(["p2"], "p1");
      FakePeerConnection.instances[0].enterState("disconnected");

      expect(disconnected).toEqual([]);
    });

    it("drops a failed peer from the mesh so the next diff re-dials it", async () => {
      vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
      const { manager, disconnected } = createManager();
      manager.setLocalStream(FakeMediaStream);

      await manager.updatePeers(["p2"], "p1");
      FakePeerConnection.instances[0].enterState("failed");
      // Same desired set: the peer counts as new again only if the failed
      // connection was removed from the mesh.
      await manager.updatePeers(["p2"], "p1");

      expect(disconnected).toEqual(["p2"]);
      expect(FakePeerConnection.instances).toHaveLength(2);
    });

    it("closes the failed connection so it releases the local tracks", async () => {
      // Forgetting the pc without closing it leaves its senders — and their
      // references to the camera tracks — alive for the life of the page.
      vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
      const { manager } = createManager();
      manager.setLocalStream(FakeMediaStream);

      await manager.updatePeers(["p2"], "p1");
      FakePeerConnection.instances[0].enterState("failed");

      expect(FakePeerConnection.instances[0].closed).toBe(true);
    });
  });

  describe("overlapping reconciles", () => {
    /**
     * The first connection opened blocks in createOffer until the test releases
     * it; later ones resolve straight away. That is the window in which a
     * second reconcile used to interleave.
     */
    class BlockingPeerConnection extends FakePeerConnection {
      static release: (() => void) | null = null;
      async createOffer() {
        if (FakePeerConnection.instances.indexOf(this) === 0) {
          await new Promise<void>((resolve) => {
            BlockingPeerConnection.release = resolve;
          });
        }
        return { type: "offer", sdp: "fake-sdp" };
      }
    }

    it("queues a reconcile that arrives mid-flight and applies only the latest", async () => {
      // The caller is an effect over the whole runner store, so it re-runs on
      // unrelated writes while an offer is in flight. Interleaved, the second
      // run could not close a peer the first had not opened yet, and the
      // participant was left connected to a partner nobody assigned.
      vi.stubGlobal("RTCPeerConnection", BlockingPeerConnection);
      const { manager } = createManager();
      manager.setLocalStream(FakeMediaStream);

      const first = manager.updatePeers(["p2", "p3"], "p1");
      // Let the first call reach its await, with p3 not yet opened.
      await Promise.resolve();
      // The rotation moved on: this seat now has no partner at all.
      await manager.updatePeers([], "p1");
      BlockingPeerConnection.release?.();
      await first;

      expect(FakePeerConnection.instances).toHaveLength(2);
      expect(FakePeerConnection.instances.map((pc) => pc.closed)).toEqual([true, true]);
    });
  });

  describe("without local media", () => {
    /** getTracks() is all initiateConnection and setLocalStream touch. */
    const NoTracksStream = { getTracks: () => [] } as unknown as MediaStream;

    it("opens no connection while no local stream has been set", async () => {
      // An offer built before getUserMedia resolves carries no tracks, and the
      // far end shows a permanently black tile with no error anywhere.
      vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
      const { manager } = createManager();

      await manager.updatePeers(["p2", "p3"], "p1");

      expect(FakePeerConnection.instances).toHaveLength(0);
    });

    it("opens the deferred connections once the local stream lands", async () => {
      vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
      const { manager } = createManager();

      await manager.updatePeers(["p2", "p3"], "p1");
      manager.setLocalStream(NoTracksStream);
      await manager.updatePeers(["p2", "p3"], "p1");

      expect(FakePeerConnection.instances).toHaveLength(2);
    });
  });
});

describe("PeerManager — receive-only and resets", () => {
  afterEach(() => {
    FakePeerConnection.instances = [];
    vi.unstubAllGlobals();
  });

  const streamWith = (...kinds: string[]) =>
    ({ getTracks: () => kinds.map((kind) => ({ kind })) }) as unknown as MediaStream;

  it("dials without local media when not publishing, asking to receive", async () => {
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    const { manager } = createManager();
    manager.setPublishing(false);
    manager.setReceiveKinds(["video"]);

    await manager.updatePeers(["p2"], "p1");

    expect(FakePeerConnection.instances).toHaveLength(1);
    expect(FakePeerConnection.instances[0].transceivers).toEqual([["video", "recvonly"]]);
  });

  it("asks to receive only the kinds it does not send", async () => {
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    const { manager } = createManager();
    manager.setLocalStream(streamWith("audio"));
    manager.setReceiveKinds(["video", "audio"]);

    await manager.updatePeers(["p2"], "p1");

    expect(FakePeerConnection.instances[0].transceivers).toEqual([["video", "recvonly"]]);
  });

  it("waits for media again after the local stream is cleared", async () => {
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    const { manager } = createManager();
    manager.setLocalStream(FakeMediaStream);
    manager.clearLocalStream();

    await manager.updatePeers(["p2"], "p1");

    expect(FakePeerConnection.instances).toHaveLength(0);
  });

  it("resetConnections closes every peer and the next reconcile re-dials", async () => {
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    const { manager, disconnected } = createManager();
    manager.setLocalStream(FakeMediaStream);
    await manager.updatePeers(["p2", "p3"], "p1");

    manager.resetConnections();
    expect(FakePeerConnection.instances.every((pc) => pc.closed)).toBe(true);
    expect(disconnected.sort()).toEqual(["p2", "p3"]);

    await manager.updatePeers(["p2", "p3"], "p1");
    expect(FakePeerConnection.instances).toHaveLength(4);
  });
});

describe("PeerManager — incoming offers and renegotiation", () => {
  /** node has no RTCSessionDescription; handleOffer/handleAnswer construct one. */
  class SessionDescriptionStub {
    type: string;
    sdp?: string;
    constructor(init: { type: string; sdp?: string }) {
      this.type = init.type;
      this.sdp = init.sdp;
    }
  }

  beforeEach(() => {
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    vi.stubGlobal("RTCSessionDescription", SessionDescriptionStub);
  });

  afterEach(() => {
    FakePeerConnection.instances = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** A remote session is identified by its DTLS fingerprint. */
  const offerFrom = (fingerprint: string): RTCSessionDescriptionInit => ({
    type: "offer",
    sdp: `v=0\r\na=fingerprint:sha-256 ${fingerprint}\r\n`,
  });

  /** The signalling handlers are private; the socket is what calls them in the browser. */
  const signals = (manager: PeerManager) =>
    manager as unknown as {
      handleOffer(fromPeerId: string, sdp: RTCSessionDescriptionInit): Promise<void>;
      handleAnswer(fromPeerId: string, sdp: RTCSessionDescriptionInit): Promise<void>;
    };

  const streamWith = (...kinds: string[]) =>
    ({ getTracks: () => kinds.map((kind) => ({ kind })) }) as unknown as MediaStream;

  /** setLocalStream renegotiates without awaiting; let that chain run. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("replaces the connection quietly when an offer comes from a new session", async () => {
    // The far side reset its connections (a publish change): applying the new
    // session's offer to the old pc is rejected and the pair stays dead.
    const { manager, disconnected } = createManager();
    await manager.updatePeers(["p1"], "p2");
    await signals(manager).handleOffer("p1", offerFrom("AA"));
    await signals(manager).handleOffer("p1", offerFrom("BB"));

    const [old, fresh] = FakePeerConnection.instances;
    expect(FakePeerConnection.instances).toHaveLength(2);
    expect(old.closed).toBe(true);
    expect(fresh.remoteDescription?.sdp).toContain("BB");
    expect(fresh.localTypes).toEqual(["answer"]);
    // Handlers were detached, so the old pc cannot report a drop later either.
    old.enterState("closed");
    expect(disconnected).toEqual([]);
  });

  it("applies an offer from the same session to the existing connection", async () => {
    const { manager } = createManager();
    await manager.updatePeers(["p1"], "p2");
    await signals(manager).handleOffer("p1", offerFrom("AA"));
    await signals(manager).handleOffer("p1", offerFrom("AA"));

    expect(FakePeerConnection.instances).toHaveLength(1);
    expect(FakePeerConnection.instances[0].closed).toBe(false);
    expect(FakePeerConnection.instances[0].localTypes).toEqual(["answer", "answer"]);
  });

  describe("glare", () => {
    it("the higher id rolls back its own offer and answers", async () => {
      const { manager } = createManager();
      manager.setLocalStream(FakeMediaStream);
      await manager.updatePeers(["p1"], "p2");
      await manager.initiateConnection("p1");

      await signals(manager).handleOffer("p1", offerFrom("AA"));

      const [pc] = FakePeerConnection.instances;
      expect(FakePeerConnection.instances).toHaveLength(1);
      expect(pc.localTypes).toEqual(["offer", "rollback", "answer"]);
      expect(pc.remoteDescription?.sdp).toContain("AA");
    });

    it("the lower id ignores the crossing offer", async () => {
      const { manager } = createManager();
      manager.setLocalStream(FakeMediaStream);
      await manager.updatePeers(["p2"], "p1");

      await signals(manager).handleOffer("p2", offerFrom("AA"));

      const [pc] = FakePeerConnection.instances;
      expect(pc.localTypes).toEqual(["offer"]);
      expect(pc.remoteDescription).toBeNull();
    });

    it("is polite before any reconcile has named this participant", async () => {
      const { manager } = createManager();
      await manager.initiateConnection("p2");

      await signals(manager).handleOffer("p2", offerFrom("AA"));

      expect(FakePeerConnection.instances[0].localTypes).toEqual(["offer", "rollback", "answer"]);
    });
  });

  describe("setLocalStream", () => {
    it("renegotiates a stable connection it added a track to", async () => {
      // The answer went out trackless while getUserMedia was still pending;
      // addTrack alone would leave the far tile black.
      const { manager } = createManager();
      await signals(manager).handleOffer("p1", offerFrom("AA"));

      manager.setLocalStream(streamWith("video"));
      await flush();

      expect(FakePeerConnection.instances[0].localTypes).toEqual(["answer", "offer"]);
    });

    it("waits for a connection that is mid-negotiation, then renegotiates once it is stable", async () => {
      const { manager } = createManager();
      await manager.initiateConnection("p2");

      manager.setLocalStream(streamWith("video"));
      await flush();

      const [pc] = FakePeerConnection.instances;
      expect(pc.senders).toHaveLength(1);
      expect(pc.localTypes).toEqual(["offer"]);

      await signals(manager).handleAnswer("p2", { type: "answer", sdp: "v=0" });
      await flush();
      expect(pc.localTypes).toEqual(["offer", "offer"]);
    });

    it("sends the camera when it starts while the answer is being built", async () => {
      // The race seen in two real browsers: the answer went out receive-only,
      // and the camera landed before it was applied. Without the follow-up
      // offer, the far side never sees this participant.
      const { manager } = createManager();
      const answering = signals(manager).handleOffer("p1", offerFrom("AA"));
      const [pc] = FakePeerConnection.instances;
      while (pc.signalingState !== "have-remote-offer") await Promise.resolve();

      manager.setLocalStream(streamWith("video"));
      await answering;
      await flush();

      expect(pc.localTypes).toEqual(["answer", "offer"]);
    });

    it("forgets a pending renegotiation when the connection closes", async () => {
      const { manager } = createManager();
      await manager.initiateConnection("p2");
      manager.setLocalStream(streamWith("video"));
      const [pc] = FakePeerConnection.instances;

      manager.closePeer("p2");
      await signals(manager).handleAnswer("p2", { type: "answer", sdp: "v=0" });
      await flush();
      expect(pc.localTypes).toEqual(["offer"]);
    });

    it("does not renegotiate when every track was already being sent", async () => {
      const { manager } = createManager();
      manager.setLocalStream(streamWith("video"));
      await signals(manager).handleOffer("p1", offerFrom("AA"));

      manager.setLocalStream(streamWith("video"));
      await flush();

      expect(FakePeerConnection.instances[0].localTypes).toEqual(["answer"]);
    });
  });

  it("logs a rejected offer or answer instead of throwing", async () => {
    class RejectingPeerConnection extends FakePeerConnection {
      async setRemoteDescription(): Promise<void> {
        throw new Error("InvalidAccessError");
      }
    }
    vi.stubGlobal("RTCPeerConnection", RejectingPeerConnection);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { manager } = createManager();
    manager.setLocalStream(FakeMediaStream);
    await manager.updatePeers(["p2"], "p1");

    await expect(signals(manager).handleOffer("p3", offerFrom("AA"))).resolves.toBeUndefined();
    await expect(signals(manager).handleAnswer("p2", { type: "answer", sdp: "v=0" })).resolves.toBeUndefined();

    expect(logged.mock.calls.map(([message]) => message)).toEqual([
      "[PeerManager] Failed to apply offer from p3:",
      "[PeerManager] Failed to apply answer from p2:",
    ]);
  });
});
