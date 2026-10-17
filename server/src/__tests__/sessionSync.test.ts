import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import prisma from "../prisma.js";

vi.mock("../prisma.js", () => ({
  default: {
    experiment: { findUnique: vi.fn() },
    participant: { findUnique: vi.fn(), update: vi.fn() },
    experimentContent: { findFirst: vi.fn(), findMany: vi.fn() },
    session: { update: vi.fn(), findUnique: vi.fn() },
    sessionParticipant: { findFirst: vi.fn(), findMany: vi.fn() },
    sessionGrouping: { upsert: vi.fn() },
  },
}));

/** Progress every member sits on when they reach the barrier. */
const StartProgress = 0;
/** Progress the cohort is released into. */
const ReleasedProgress = StartProgress + 1;

function createMockSocket(id: string) {
  const handlers = new Map<string, Function>();
  return {
    id,
    data: {} as Record<string, unknown>,
    on: vi.fn((event: string, handler: Function) => {
      handlers.set(event, handler);
    }),
    emit: vi.fn(),
    join: vi.fn(),
    to: vi.fn(() => ({ emit: vi.fn() })),
    disconnect: vi.fn(),
    _trigger: (event: string, ...args: unknown[]) => {
      const handler = handlers.get(event);
      if (handler) return handler(...args);
    },
  };
}

function createMockNamespace() {
  return {
    to: vi.fn(() => ({ emit: vi.fn() })),
    fetchSockets: vi.fn(async () => [] as unknown[]),
  };
}

/**
 * Both members of a dyad, seat 0 (p1) and seat 1 (p2), in one ACTIVE session.
 *
 * The session is CLOSABLE: once prisma.session.update marks it CLOSED,
 * sessionParticipant.findFirst resolves null, which is what the real database
 * does. A mock that always returns the session cannot fail on the
 * close-then-deliver ordering bug, so this behaviour is load-bearing.
 */
function mockDyadSession(
  sessionId: string,
  seatConditions: { p1: string; p2: string } = { p1: "Basic", p2: "Basic" },
) {
  const sessionState = { closed: false };

  vi.mocked(prisma.session.update).mockImplementation((async (args: {
    where: { id: string };
    data: { status?: string };
  }) => {
    if (args.where.id === sessionId && args.data.status === "CLOSED") {
      sessionState.closed = true;
    }
    return {};
  }) as never);

  vi.mocked(prisma.sessionParticipant.findFirst).mockImplementation((async (args: {
    where: { participantId: string };
  }) => {
    if (sessionState.closed) return null;
    return {
      id: `sp-${args.where.participantId}`,
      seat: args.where.participantId === "p1" ? 0 : 1,
      slotName: null,
      session: {
        id: sessionId,
        status: "ACTIVE",
        matchProgress: StartProgress,
        sharedProgressSequence: null,
        participants: [
          {
            participantId: "p1",
            seat: 0,
            status: "ACTIVE",
            participant: { condition: seatConditions.p1 },
          },
          {
            participantId: "p2",
            seat: 1,
            status: "ACTIVE",
            participant: { condition: seatConditions.p2 },
          },
        ],
      },
    };
  }) as never);

  vi.mocked(prisma.sessionParticipant.findMany).mockImplementation((async () =>
    sessionState.closed
      ? []
      : [{ session: { id: sessionId, status: "ACTIVE" } }]) as never);

  // The session row itself, read back by the in-flight-close guard.
  vi.mocked(prisma.session.findUnique).mockImplementation((async () => ({
    status: sessionState.closed ? "CLOSED" : "ACTIVE",
  })) as never);

  return sessionState;
}

function makeContent(progress: number, routine: string, condition: string) {
  return {
    id: `content-${routine}-${progress}`,
    experimentId: "exp-1",
    progress,
    trialNumber: 1,
    routine,
    content: {},
    condition,
    description: null,
  };
}

describe("session sync barrier", () => {
  let socket1: ReturnType<typeof createMockSocket>;
  let socket2: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(async () => {
    socket1 = createMockSocket("s1");
    socket2 = createMockSocket("s2");
    ns = createMockNamespace();

    const { registerProgressHandler } = await import("../socket/progressHandler.js");
    registerProgressHandler(ns as never, socket1 as never);
    registerProgressHandler(ns as never, socket2 as never);

    socket1.data = {
      experimentId: "exp-1",
      participantId: "p1",
      responseId: "resp-1",
      condition: "Basic",
      progress: StartProgress,
    };
    socket2.data = {
      experimentId: "exp-1",
      participantId: "p2",
      responseId: "resp-2",
      condition: "Basic",
      progress: StartProgress,
    };

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1",
      randomization: false,
      routines: [
        {
          name: "chat",
          type: "routine-video-chat",
          elements: [{ name: "prompt", type: "text", params: { content: "Talk together" } }],
        },
        {
          name: "chat-a",
          type: "routine-video-chat",
          elements: [{ name: "prompt-a", type: "text", params: { content: "Prompt A" } }],
        },
        {
          name: "chat-b",
          type: "routine-video-chat",
          elements: [{ name: "prompt-b", type: "text", params: { content: "Prompt B" } }],
        },
        {
          // A deliberately solo group: each seat is its own group of one.
          name: "solo-fixed",
          type: "routine-video-chat",
          elements: [],
          interactionPattern: { type: "fixed", groups: [[0], [1]] },
        },
        {
          name: "wrap",
          type: "routine-end-matching",
          elements: [{ name: "thanks", type: "text", params: { content: "Chat finished" } }],
        },
      ],
    } as never);
    vi.mocked(prisma.participant.update).mockResolvedValue({} as never);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      role: 0,
      properties: {},
    } as never);
    vi.mocked(prisma.experimentContent.findMany).mockResolvedValue([] as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("holds every member until the last one proceeds", async () => {
    mockDyadSession("sess-hold");
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(
      makeContent(ReleasedProgress, "chat", "Basic") as never,
    );
    ns.fetchSockets.mockResolvedValue([socket1, socket2]);

    await socket1._trigger("exp:proceed");

    expect(prisma.participant.update).not.toHaveBeenCalled();
    expect(socket1.emit).not.toHaveBeenCalled();
    expect(socket2.emit).not.toHaveBeenCalled();
  });

  it("delivers content to every member when the barrier completes", async () => {
    mockDyadSession("sess-release");
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(
      makeContent(ReleasedProgress, "chat", "Basic") as never,
    );
    ns.fetchSockets.mockResolvedValue([socket1, socket2]);

    await socket1._trigger("exp:proceed");
    await socket2._trigger("exp:proceed");

    expect(prisma.participant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1" },
        data: expect.objectContaining({ progress: ReleasedProgress }),
      }),
    );
    expect(prisma.participant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p2" },
        data: expect.objectContaining({ progress: ReleasedProgress }),
      }),
    );

    expect(socket1.emit).toHaveBeenCalledWith(
      "exp:content",
      expect.objectContaining({
        progress: ReleasedProgress,
        interactionGroup: {
          peers: ["p2"], seat: 0, groupIndex: 0, partnerUnavailable: false,
          members: [expect.objectContaining({ participantId: "p1", seat: 0 }), expect.objectContaining({ participantId: "p2", seat: 1 })],
        },
      }),
    );
    expect(socket2.emit).toHaveBeenCalledWith(
      "exp:content",
      expect.objectContaining({
        progress: ReleasedProgress,
        interactionGroup: {
          peers: ["p1"], seat: 1, groupIndex: 0, partnerUnavailable: false,
          members: [expect.objectContaining({ participantId: "p1", seat: 0 }), expect.objectContaining({ participantId: "p2", seat: 1 })],
        },
      }),
    );
  });

  it("resolves each member's content against their own condition", async () => {
    // The seat roster must carry the SAME conditions as the sockets:
    // state.condition is Participant.condition, so any other pairing models a
    // database state that cannot exist.
    mockDyadSession("sess-condition", { p1: "A", p2: "B" });
    socket1.data.condition = "A";
    socket2.data.condition = "B";
    vi.mocked(prisma.experimentContent.findFirst).mockImplementation((async (args: {
      where: { condition: string };
    }) =>
      makeContent(
        ReleasedProgress,
        args.where.condition === "A" ? "chat-a" : "chat-b",
        args.where.condition,
      )) as never);
    ns.fetchSockets.mockResolvedValue([socket1, socket2]);

    await socket1._trigger("exp:proceed");
    await socket2._trigger("exp:proceed");

    expect(socket1.emit).toHaveBeenCalledWith(
      "exp:content",
      expect.objectContaining({ routine: expect.objectContaining({ name: "chat-a" }) }),
    );
    expect(socket2.emit).toHaveBeenCalledWith(
      "exp:content",
      expect.objectContaining({ routine: expect.objectContaining({ name: "chat-b" }) }),
    );
  });

  it("serves every member before closing an end-matching session", async () => {
    mockDyadSession("sess-end");
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(
      makeContent(ReleasedProgress, "wrap", "Basic") as never,
    );
    ns.fetchSockets.mockResolvedValue([socket1, socket2]);

    await socket1._trigger("exp:proceed");
    await socket2._trigger("exp:proceed");

    // Both members keep their seat and their peers: the close must not happen
    // between the first member's delivery and the second member's.
    expect(socket1.emit).toHaveBeenCalledWith(
      "exp:content",
      expect.objectContaining({
        routine: expect.objectContaining({ name: "wrap" }),
        interactionGroup: {
          peers: ["p2"], seat: 0, groupIndex: 0, partnerUnavailable: false,
          members: [expect.objectContaining({ participantId: "p1", seat: 0 }), expect.objectContaining({ participantId: "p2", seat: 1 })],
        },
      }),
    );
    expect(socket2.emit).toHaveBeenCalledWith(
      "exp:content",
      expect.objectContaining({
        routine: expect.objectContaining({ name: "wrap" }),
        interactionGroup: {
          peers: ["p1"], seat: 1, groupIndex: 0, partnerUnavailable: false,
          members: [expect.objectContaining({ participantId: "p1", seat: 0 }), expect.objectContaining({ participantId: "p2", seat: 1 })],
        },
      }),
    );

    // ...and the session is still closed, exactly once, afterwards.
    expect(prisma.session.update).toHaveBeenCalledTimes(1);
    expect(prisma.session.update).toHaveBeenCalledWith({
      where: { id: "sess-end" },
      data: { status: "CLOSED" },
    });
  });

  it("advances the stored progress of a member whose socket has gone", async () => {
    mockDyadSession("sess-gone");
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(
      makeContent(ReleasedProgress, "chat", "Basic") as never,
    );

    // P1 reaches the barrier, then disconnects before P2 releases it.
    ns.fetchSockets.mockResolvedValue([socket1, socket2]);
    await socket1._trigger("exp:proceed");
    ns.fetchSockets.mockResolvedValue([socket2]);
    await socket2._trigger("exp:proceed");

    expect(prisma.participant.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { progress: { increment: 1 }, currentStage: 0 },
    });
    expect(socket2.emit).toHaveBeenCalledWith(
      "exp:content",
      expect.objectContaining({ progress: ReleasedProgress }),
    );
  });

  it("still serves the cohort when one member's advance throws", async () => {
    mockDyadSession("sess-failure");
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(
      makeContent(ReleasedProgress, "wrap", "Basic") as never,
    );

    // P1 reaches the barrier and disconnects, and their catch-up write then
    // fails — their participant row was deleted. P2 must still be served and
    // the end-matching session must still be closed.
    ns.fetchSockets.mockResolvedValue([socket1, socket2]);
    await socket1._trigger("exp:proceed");
    ns.fetchSockets.mockResolvedValue([socket2]);
    vi.mocked(prisma.participant.update).mockRejectedValueOnce(
      new Error("Participant p1 no longer exists"),
    );
    await socket2._trigger("exp:proceed");

    expect(socket2.emit).toHaveBeenCalledWith(
      "exp:content",
      expect.objectContaining({
        routine: expect.objectContaining({ name: "wrap" }),
      }),
    );
    expect(prisma.session.update).toHaveBeenCalledWith({
      where: { id: "sess-failure" },
      data: { status: "CLOSED" },
    });
  });

  it("does not call an intentionally solo group a missing partner", async () => {
    // Every seat is ACTIVE; the `fixed` pattern simply schedules seat 0 alone.
    // An empty peer list here is the design, not a dropout, and the participant
    // must not be told their partner has left.
    mockDyadSession("sess-solo-fixed");
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(
      makeContent(ReleasedProgress, "solo-fixed", "Basic") as never,
    );
    ns.fetchSockets.mockResolvedValue([socket1, socket2]);

    await socket1._trigger("exp:proceed");
    await socket2._trigger("exp:proceed");

    expect(socket1.emit).toHaveBeenCalledWith(
      "exp:content",
      expect.objectContaining({
        interactionGroup: {
          peers: [], seat: 0, groupIndex: 0, partnerUnavailable: false,
          members: [expect.objectContaining({ participantId: "p1", seat: 0 })],
        },
      }),
    );
  });

  /** p1 (seat 0) is ACTIVE; p2 (seat 1) has DROPPED, so findActiveSession returns null for them. */
  function mockDyadWithDroppedSeat(sessionId: string) {
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.sessionParticipant.findFirst).mockImplementation((async (args: {
      where: { participantId: string };
    }) => {
      if (args.where.participantId !== "p1") return null;
      return {
        id: "sp-p1",
        seat: 0,
        slotName: null,
        status: "ACTIVE",
        session: {
          id: sessionId,
          status: "ACTIVE",
          matchProgress: StartProgress,
          sharedProgressSequence: null,
          participants: [
            { participantId: "p1", seat: 0, status: "ACTIVE", participant: { condition: "Basic" } },
            { participantId: "p2", seat: 1, status: "DROPPED", participant: { condition: "Basic" } },
          ],
        },
      };
    }) as never);
  }

  describe("with a dropped seat", () => {
    it("releases the barrier once every ACTIVE member has proceeded", async () => {
      mockDyadWithDroppedSeat("sess-dropped-release");
      vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(
        makeContent(ReleasedProgress, "chat", "Basic") as never,
      );
      ns.fetchSockets.mockResolvedValue([socket1]);

      await socket1._trigger("exp:proceed");

      expect(prisma.participant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "p1" },
          data: expect.objectContaining({ progress: ReleasedProgress }),
        }),
      );
      expect(socket1.emit).toHaveBeenCalledWith(
        "exp:content",
        expect.objectContaining({ progress: ReleasedProgress }),
      );
    });

    it("never advances the stored progress of the seat that dropped", async () => {
      mockDyadWithDroppedSeat("sess-dropped-progress");
      vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(
        makeContent(ReleasedProgress, "chat", "Basic") as never,
      );
      ns.fetchSockets.mockResolvedValue([socket1]);

      await socket1._trigger("exp:proceed");

      // The positive half matters: a barrier that advances NOBODY would satisfy
      // the negative assertion on its own.
      expect(prisma.participant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "p1" },
          data: expect.objectContaining({ progress: ReleasedProgress }),
        }),
      );
      expect(prisma.participant.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "p2" } }),
      );
    });

    it("lets the participant whose own seat dropped continue solo", async () => {
      // This is what the ACTIVE filter on findActiveSession buys: p2 has no
      // seat left, so they must fall through to the single-participant path
      // rather than join a barrier computed without them and stall.
      mockDyadWithDroppedSeat("sess-dropped-solo");
      vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(
        makeContent(ReleasedProgress, "chat", "Basic") as never,
      );
      ns.fetchSockets.mockResolvedValue([socket2]);

      await socket2._trigger("exp:proceed");

      expect(prisma.participant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "p2" },
          data: expect.objectContaining({ progress: ReleasedProgress }),
        }),
      );
      expect(socket2.emit).toHaveBeenCalledWith(
        "exp:content",
        expect.objectContaining({ progress: ReleasedProgress }),
      );
    });

    it("replaces the orphan's stale group instead of sending none", async () => {
      // findActiveSession returns null for p2, so without an explicit empty
      // group the client's `payload.interactionGroup ?? s.interactionGroup`
      // would keep p2 dialling p1 forever.
      mockDyadWithDroppedSeat("sess-dropped-stale-group");
      vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
        id: "exp-1",
        randomization: false,
        participantsPerSession: 2,
        routines: [
          {
            name: "chat",
            type: "routine-video-chat",
            elements: [],
          },
        ],
      } as never);
      vi.mocked(prisma.sessionParticipant.findFirst).mockImplementation((async (args: {
        where: { participantId: string; status: string };
      }) => (args.where.status === "DROPPED" ? { seat: 1 } : null)) as never);
      vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(
        makeContent(ReleasedProgress, "chat", "Basic") as never,
      );
      ns.fetchSockets.mockResolvedValue([socket2]);

      await socket2._trigger("exp:proceed");

      expect(socket2.emit).toHaveBeenCalledWith(
        "exp:content",
        expect.objectContaining({
          interactionGroup: { peers: [], seat: 1, groupIndex: 0, partnerUnavailable: true, members: [] },
        }),
      );
    });

    it("leaves the orphan with no peers and flags the partner as unavailable", async () => {
      mockDyadWithDroppedSeat("sess-dropped-peers");
      vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(
        makeContent(ReleasedProgress, "chat", "Basic") as never,
      );
      ns.fetchSockets.mockResolvedValue([socket1]);

      await socket1._trigger("exp:proceed");

      expect(socket1.emit).toHaveBeenCalledWith(
        "exp:content",
        expect.objectContaining({
          interactionGroup: {
            peers: [], seat: 0, groupIndex: 0, partnerUnavailable: true,
            members: [expect.objectContaining({ participantId: "p1", seat: 0 })],
          },
        }),
      );
    });

    it("looks up only a seat that is still ACTIVE", async () => {
      mockDyadWithDroppedSeat("sess-dropped-lookup");
      vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(
        makeContent(ReleasedProgress, "chat", "Basic") as never,
      );
      ns.fetchSockets.mockResolvedValue([socket1]);

      await socket1._trigger("exp:proceed");

      const call = vi.mocked(prisma.sessionParticipant.findFirst).mock
        .calls[0][0] as { where: { status?: string } };
      // Without this filter a participant whose own seat has DROPPED is handed
      // the cohort's session, joins a barrier that excludes them, and stalls.
      expect(call.where.status).toBe("ACTIVE");
    });

    it("releases a barrier the departed member was already holding up", async () => {
      // Both seats still ACTIVE when p1 reaches the barrier, so p1 waits.
      mockDyadSession("sess-stale");
      vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(
        makeContent(ReleasedProgress, "chat", "Basic") as never,
      );
      ns.fetchSockets.mockResolvedValue([socket1]);

      await socket1._trigger("exp:proceed");
      expect(socket1.emit).not.toHaveBeenCalled();

      // p2's seat is then dropped; the dropout path reports the survivors.
      const { releaseStaleBarrier } = await import("../socket/progressHandler.js");
      const released = await releaseStaleBarrier(ns as never, "sess-stale", ["p1"]);

      expect(released).toBe(true);
      expect(socket1.emit).toHaveBeenCalledWith(
        "exp:content",
        expect.objectContaining({ progress: ReleasedProgress }),
      );
    });

    it("does not release while an ACTIVE member has still not proceeded", async () => {
      mockDyadSession("sess-stale-waiting");
      vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(
        makeContent(ReleasedProgress, "chat", "Basic") as never,
      );
      ns.fetchSockets.mockResolvedValue([socket1, socket2]);

      await socket1._trigger("exp:proceed");

      const { releaseStaleBarrier } = await import("../socket/progressHandler.js");
      const released = await releaseStaleBarrier(ns as never, "sess-stale-waiting", [
        "p1",
        "p2",
      ]);

      expect(released).toBe(false);
      expect(socket1.emit).not.toHaveBeenCalled();
    });
  });
});

describe("barrier progress notice", () => {
  let socket1: ReturnType<typeof createMockSocket>;
  let socket2: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;
  let roomEmits: Array<{ room: string; event: string; payload: unknown }>;

  beforeEach(async () => {
    socket1 = createMockSocket("s1");
    socket2 = createMockSocket("s2");
    ns = createMockNamespace();
    roomEmits = [];
    ns.to.mockImplementation((room: string) => ({
      emit: (event: string, payload: unknown) => {
        roomEmits.push({ room, event, payload });
      },
    }));

    const { registerProgressHandler } = await import("../socket/progressHandler.js");
    registerProgressHandler(ns as never, socket1 as never);
    registerProgressHandler(ns as never, socket2 as never);

    socket1.data = { experimentId: "exp-1", participantId: "p1", condition: "Basic", progress: StartProgress };
    socket2.data = { experimentId: "exp-1", participantId: "p2", condition: "Basic", progress: StartProgress };

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1",
      randomization: false,
      routines: [{ name: "chat", type: "routine-video-chat", elements: [] }],
    } as never);
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(
      makeContent(ReleasedProgress, "chat", "Basic") as never,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tells the cohort how many have submitted while the barrier holds", async () => {
    mockDyadSession("sess-notice");
    ns.fetchSockets.mockResolvedValue([socket1, socket2]);

    await socket1._trigger("exp:proceed");

    expect(roomEmits).toContainEqual({
      room: "session:sess-notice",
      event: "exp:sync",
      payload: { submitted: 1, total: 2, progress: StartProgress },
    });
  });

  it("counts each member once however often they proceed", async () => {
    mockDyadSession("sess-repeat");
    ns.fetchSockets.mockResolvedValue([socket1, socket2]);

    await socket1._trigger("exp:proceed");
    await socket1._trigger("exp:proceed");

    const counts = roomEmits
      .filter((e) => e.event === "exp:sync")
      .map((e) => (e.payload as { submitted: number }).submitted);
    expect(counts).toEqual([1, 1]);
  });

  it("sends no notice once the barrier releases", async () => {
    mockDyadSession("sess-done");
    ns.fetchSockets.mockResolvedValue([socket1, socket2]);

    await socket1._trigger("exp:proceed");
    roomEmits.length = 0;
    await socket2._trigger("exp:proceed");

    expect(roomEmits.filter((e) => e.event === "exp:sync")).toEqual([]);
  });
});

describe("closing a session that still holds someone at the barrier", () => {
  let socket1: ReturnType<typeof createMockSocket>;
  let socket2: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(async () => {
    socket1 = createMockSocket("s1");
    socket2 = createMockSocket("s2");
    ns = createMockNamespace();

    const { registerProgressHandler } = await import("../socket/progressHandler.js");
    registerProgressHandler(ns as never, socket1 as never);
    registerProgressHandler(ns as never, socket2 as never);

    socket1.data = { experimentId: "exp-1", participantId: "p1", condition: "Basic", progress: StartProgress };
    socket2.data = { experimentId: "exp-1", participantId: "p2", condition: "Basic", progress: StartProgress };

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1",
      randomization: false,
      routines: [{ name: "chat", type: "routine-video-chat", elements: [] }],
    } as never);
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(
      makeContent(ReleasedProgress, "chat", "Basic") as never,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("advances a member the barrier would otherwise abandon", async () => {
    // The stranding case, seen in the browser: the cohort is released, the
    // first member served immediately proceeds out of the next routine and
    // lands in a fresh barrier, and THEN the session closes. Forgetting that
    // barrier leaves them on "Proceeding..." for good, while the member whose
    // proceed arrived after the close advances alone and finishes normally.
    mockDyadSession("sess-abandon");
    ns.fetchSockets.mockResolvedValue([socket1, socket2]);
    await socket1._trigger("exp:proceed");
    socket1.emit.mockClear();

    const { closeSession } = await import("../socket/progressHandler.js");
    await closeSession(ns as never, "sess-abandon", "exp-1");

    expect(socket1.emit).toHaveBeenCalledWith("exp:content", expect.anything());
  });

  it("leaves a member who never reached the barrier where they are", async () => {
    mockDyadSession("sess-untouched");
    ns.fetchSockets.mockResolvedValue([socket1, socket2]);
    await socket1._trigger("exp:proceed");
    socket2.emit.mockClear();

    const { closeSession } = await import("../socket/progressHandler.js");
    await closeSession(ns as never, "sess-untouched", "exp-1");

    // p2 has not said they are done; advancing them would skip their routine.
    expect(socket2.emit).not.toHaveBeenCalled();
  });

  it("closes a session nobody is waiting in without advancing anyone", async () => {
    mockDyadSession("sess-empty");
    ns.fetchSockets.mockResolvedValue([socket1, socket2]);

    const { closeSession } = await import("../socket/progressHandler.js");
    await closeSession(ns as never, "sess-empty", "exp-1");

    expect(socket1.emit).not.toHaveBeenCalled();
    expect(socket2.emit).not.toHaveBeenCalled();
  });
});

describe("a session that closes while a proceed is in flight", () => {
  let socket1: ReturnType<typeof createMockSocket>;
  let socket2: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;
  let roomEmits: Array<{ room: string; event: string; payload: unknown }>;

  beforeEach(async () => {
    socket1 = createMockSocket("s1");
    socket2 = createMockSocket("s2");
    ns = createMockNamespace();
    roomEmits = [];
    ns.to.mockImplementation((room: string) => ({
      emit: (event: string, payload: unknown) => {
        roomEmits.push({ room, event, payload });
      },
    }));

    const { registerProgressHandler } = await import("../socket/progressHandler.js");
    registerProgressHandler(ns as never, socket1 as never);
    registerProgressHandler(ns as never, socket2 as never);

    socket1.data = { experimentId: "exp-1", participantId: "p1", condition: "Basic", progress: StartProgress };
    socket2.data = { experimentId: "exp-1", participantId: "p2", condition: "Basic", progress: StartProgress };

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1",
      randomization: false,
      routines: [{ name: "chat", type: "routine-video-chat", elements: [] }],
    } as never);
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(
      makeContent(ReleasedProgress, "chat", "Basic") as never,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("advances a member whose session closed between the lookup and the barrier", async () => {
    // findActiveSession awaits. A close landing in that gap clears a barrier
    // the member is not in yet, and the member then joins one nobody will ever
    // clear — they sit on "Proceeding..." while their partner finishes.
    // Reading ACTIVE from the seat lookup and CLOSED from the session row is
    // exactly that interleaving.
    mockDyadSession("sess-inflight");
    vi.mocked(prisma.session.findUnique).mockResolvedValue({ status: "CLOSED" } as never);
    ns.fetchSockets.mockResolvedValue([socket1, socket2]);

    await socket1._trigger("exp:proceed");

    expect(socket1.emit).toHaveBeenCalledWith("exp:content", expect.anything());
    // And no barrier notice, because there is no cohort left to wait for.
    expect(roomEmits.filter((e) => e.event === "exp:sync")).toEqual([]);
  });

  it("still holds at the barrier while the session is open", async () => {
    mockDyadSession("sess-open");
    vi.mocked(prisma.session.findUnique).mockResolvedValue({ status: "ACTIVE" } as never);
    ns.fetchSockets.mockResolvedValue([socket1, socket2]);

    await socket1._trigger("exp:proceed");

    expect(socket1.emit).not.toHaveBeenCalledWith("exp:content", expect.anything());
    expect(roomEmits.filter((e) => e.event === "exp:sync")).toHaveLength(1);
  });

  it("does not advance a member the closing session already rescued", async () => {
    // Both the close and the in-flight proceed can notice the same member.
    // Whoever takes them out of the barrier owns them; the other must not
    // advance them a second time and skip a routine.
    mockDyadSession("sess-both");
    vi.mocked(prisma.session.findUnique).mockResolvedValue({ status: "CLOSED" } as never);
    ns.fetchSockets.mockResolvedValue([socket1, socket2]);
    const { closeSession } = await import("../socket/progressHandler.js");

    const inFlight = socket1._trigger("exp:proceed");
    await closeSession(ns as never, "sess-both", "exp-1");
    await inFlight;

    const contents = socket1.emit.mock.calls.filter((c) => c[0] === "exp:content");
    expect(contents).toHaveLength(1);
  });
});
