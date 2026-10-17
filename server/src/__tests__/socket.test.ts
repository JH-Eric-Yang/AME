import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import prisma from "../prisma.js";
import { hasPendingSeatDrop, cancelSeatDrop } from "../socket/sessionDropout.js";

// Mock prisma
vi.mock("../prisma.js", () => ({
  default: {
    experiment: { findUnique: vi.fn(), update: vi.fn() },
    participant: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    experimentContent: { findFirst: vi.fn() },
    experimentResult: { create: vi.fn() },
    session: { create: vi.fn(), update: vi.fn() },
    sessionParticipant: { findFirst: vi.fn(), findMany: vi.fn() },
    upload: { update: vi.fn() },
  },
}));

// ── Helper to build a mock socket ──────────────────────

function createMockSocket(id = "socket-1") {
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
    // Helper to trigger registered handlers in tests
    _trigger: (event: string, ...args: unknown[]) => {
      const handler = handlers.get(event);
      if (handler) return handler(...args);
    },
    _handlers: handlers,
  };
}

function createMockNamespace() {
  return {
    to: vi.fn(() => ({ emit: vi.fn() })),
    fetchSockets: vi.fn(async () => []),
  };
}

// ── Experiment Handler Tests ───────────────────────────

describe("experimentHandler", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(async () => {
    socket = createMockSocket();
    ns = createMockNamespace();

    // Dynamically import to get fresh module state
    const { registerExperimentHandler } = await import("../socket/experimentHandler.js");
    registerExperimentHandler(ns as never, socket as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits config on exp:init with valid experiment", async () => {
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1",
      name: "Test",
      description: "A test",
      visible: true,
      avCollection: false,
      bodyDetection: false,
      videoChat: true,
      supplementaryDevice: "NONE",
      participantsPerSession: 2,
      conditions: ["A", "B"],
    } as never);

    await socket._trigger("exp:init", { experimentId: "exp-1", platform: "chrome" });

    expect(socket.emit).toHaveBeenCalledWith("exp:config", expect.objectContaining({
      id: "exp-1",
      name: "Test",
      videoChat: true,
    }));
  });

  it("emits error on exp:init with non-existent experiment", async () => {
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(null);

    await socket._trigger("exp:init", { experimentId: "nope", platform: "chrome" });

    expect(socket.emit).toHaveBeenCalledWith("error", expect.objectContaining({
      code: "NOT_FOUND",
    }));
  });

  it("emits error on exp:init with invisible experiment", async () => {
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1",
      visible: false,
    } as never);

    await socket._trigger("exp:init", { experimentId: "exp-1", platform: "chrome" });

    expect(socket.emit).toHaveBeenCalledWith("error", expect.objectContaining({
      code: "NOT_AVAILABLE",
    }));
  });

  it("creates new participant on exp:join without responseId", async () => {
    // Must set experimentId on the existing data object (handler captured reference)
    (socket.data as Record<string, unknown>).experimentId = "exp-1";
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1",
      allowNew: true,
      conditions: ["A", "B"],
      currentCondition: null,
      rollBackTime: 60,
    } as never);
    vi.mocked(prisma.experiment.update).mockResolvedValue({} as never);
    vi.mocked(prisma.participant.create).mockResolvedValue({
      id: "part-1",
      responseId: "resp-1",
      progress: 0,
      condition: "A",
    } as never);

    await socket._trigger("exp:join", {});

    expect(prisma.participant.create).toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith("exp:joined", expect.objectContaining({
      participantId: "part-1",
      condition: "A",
    }));
  });

  describe("external participant id", () => {
    function mockExperiment(participantIdParam: string | null) {
      vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
        id: "exp-1",
        allowNew: true,
        conditions: [],
        currentCondition: null,
        rollBackTime: 60,
        participantIdParam,
      } as never);
    }

    it("resumes the participant matching the external id", async () => {
      (socket.data as Record<string, unknown>).experimentId = "exp-1";
      mockExperiment("PROLIFIC_PID");
      vi.mocked(prisma.participant.findFirst).mockResolvedValue({
        id: "part-9",
        responseId: "resp-9",
        progress: 4,
        condition: null,
        completion: false,
        lastLogTime: new Date(),
        properties: {},
      } as never);
      vi.mocked(prisma.participant.update).mockResolvedValue({
        id: "part-9",
        responseId: "resp-9",
        progress: 4,
        condition: null,
        properties: {},
      } as never);

      await socket._trigger("exp:join", { externalId: "pid-abc" });

      expect(prisma.participant.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ externalId: "pid-abc" }),
        }),
      );
      expect(prisma.participant.create).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith(
        "exp:joined",
        expect.objectContaining({ participantId: "part-9" }),
      );
    });

    it("refuses an external id that has already completed", async () => {
      (socket.data as Record<string, unknown>).experimentId = "exp-1";
      mockExperiment("PROLIFIC_PID");
      vi.mocked(prisma.participant.findFirst).mockResolvedValue({
        id: "part-9",
        responseId: "resp-9",
        completion: true,
      } as never);

      await socket._trigger("exp:join", { externalId: "pid-abc" });

      expect(socket.emit).toHaveBeenCalledWith(
        "error",
        expect.objectContaining({ code: "ALREADY_COMPLETED" }),
      );
      expect(socket.emit).not.toHaveBeenCalledWith("exp:joined", expect.anything());
    });

    it("stores the external id on a newly created participant", async () => {
      (socket.data as Record<string, unknown>).experimentId = "exp-1";
      mockExperiment("PROLIFIC_PID");
      vi.mocked(prisma.participant.findFirst).mockResolvedValue(null as never);
      vi.mocked(prisma.participant.create).mockResolvedValue({
        id: "part-1",
        responseId: "resp-1",
        progress: 0,
        condition: null,
      } as never);

      await socket._trigger("exp:join", { externalId: "  pid-abc  " });

      expect(prisma.participant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ externalId: "pid-abc" }),
        }),
      );
    });

    it("ignores an external id when the experiment does not capture one", async () => {
      (socket.data as Record<string, unknown>).experimentId = "exp-1";
      mockExperiment(null);
      vi.mocked(prisma.participant.findFirst).mockResolvedValue(null as never);
      vi.mocked(prisma.participant.create).mockResolvedValue({
        id: "part-1",
        responseId: "resp-1",
        progress: 0,
        condition: null,
      } as never);

      await socket._trigger("exp:join", { externalId: "pid-abc" });

      expect(prisma.participant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ externalId: null }),
        }),
      );
    });
  });

  it("resumes participant on exp:join with valid responseId", async () => {
    (socket.data as Record<string, unknown>).experimentId = "exp-1";
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1",
      allowNew: true,
      conditions: [],
      rollBackTime: 60,
    } as never);
    vi.mocked(prisma.participant.findFirst).mockResolvedValue({
      id: "part-1",
      responseId: "resp-1",
      progress: 3,
      condition: "A",
      lastLogTime: new Date(), // recent
    } as never);
    vi.mocked(prisma.participant.update).mockResolvedValue({
      id: "part-1",
      responseId: "resp-1",
      progress: 3,
      condition: "A",
    } as never);

    await socket._trigger("exp:join", { responseId: "resp-1" });

    expect(socket.emit).toHaveBeenCalledWith("exp:joined", expect.objectContaining({
      progress: 3,
    }));
  });

  it("rejects new participant when allowNew is false", async () => {
    (socket.data as Record<string, unknown>).experimentId = "exp-1";
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1",
      allowNew: false,
      conditions: [],
      rollBackTime: 60,
    } as never);
    vi.mocked(prisma.participant.findFirst).mockResolvedValue(null);

    await socket._trigger("exp:join", {});

    expect(socket.emit).toHaveBeenCalledWith("error", expect.objectContaining({
      code: "NOT_ALLOWED",
    }));
  });
});

describe("experimentHandler disconnect — device sockets", () => {
  afterEach(() => {
    // These tests don't wait out ReconnectGraceMs, so cancel whatever
    // scheduleSeatDrop armed or it fires a real 30s timer after the suite ends.
    cancelSeatDrop("dev-p1");
    cancelSeatDrop("normal-p1");
    vi.restoreAllMocks();
  });

  it("schedules no seat drop and does not log out the participant when their device disconnects", async () => {
    const deviceSocket = createMockSocket("device-socket");
    deviceSocket.data = {
      participantId: "dev-p1",
      experimentId: "exp-1",
      deviceMode: "controller",
    };
    const { registerExperimentHandler } = await import("../socket/experimentHandler.js");
    registerExperimentHandler(
      createMockNamespace() as never,
      deviceSocket as never,
      {} as never,
    );

    await deviceSocket._trigger("disconnect");

    expect(hasPendingSeatDrop("dev-p1")).toBe(false);
    expect(prisma.participant.update).not.toHaveBeenCalled();
  });

  it("still schedules a seat drop and logs out a normal participant socket", async () => {
    vi.mocked(prisma.participant.update).mockResolvedValue({} as never);
    const normalSocket = createMockSocket("normal-socket");
    normalSocket.data = { participantId: "normal-p1", experimentId: "exp-1" };
    const { registerExperimentHandler } = await import("../socket/experimentHandler.js");
    registerExperimentHandler(
      createMockNamespace() as never,
      normalSocket as never,
      {} as never,
    );

    await normalSocket._trigger("disconnect");

    expect(hasPendingSeatDrop("normal-p1")).toBe(true);
    expect(prisma.participant.update).toHaveBeenCalledWith({
      where: { id: "normal-p1" },
      data: { isLoggedIn: false, lastLogTime: expect.any(Date) },
    });
  });
});

// ── Data Handler Tests ─────────────────────────────────

describe("dataHandler", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(async () => {
    socket = createMockSocket();
    ns = createMockNamespace();

    const { registerDataHandler } = await import("../socket/dataHandler.js");
    registerDataHandler(ns as never, socket as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves data and emits ack on exp:data", async () => {
    (socket.data as Record<string, unknown>).experimentId = "exp-1";
    (socket.data as Record<string, unknown>).participantId = "part-1";
    (socket.data as Record<string, unknown>).responseId = "resp-1";
    vi.mocked(prisma.experimentResult.create).mockResolvedValue({} as never);
    vi.mocked(prisma.participant.update).mockResolvedValue({} as never);

    await socket._trigger("exp:data", {
      progress: 0,
      trial: 1,
      routine: "survey",
      response: { q1: "yes" },
    });

    expect(prisma.experimentResult.create).toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith("exp:data:ack");
  });

  it("updates consent on exp:consent", async () => {
    (socket.data as Record<string, unknown>).participantId = "part-1";
    vi.mocked(prisma.participant.update).mockResolvedValue({} as never);

    await socket._trigger("exp:consent");

    expect(prisma.participant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "part-1" },
        data: expect.objectContaining({ consent: true }),
      }),
    );
  });

  it("marks participant withdrawn on exp:withdraw", async () => {
    (socket.data as Record<string, unknown>).experimentId = "exp-1";
    (socket.data as Record<string, unknown>).participantId = "part-1";
    vi.mocked(prisma.participant.update).mockResolvedValue({} as never);
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([]);

    await socket._trigger("exp:withdraw");

    expect(prisma.participant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ withdraw: true }),
      }),
    );
  });

  it("tells the participant's phone that the study ended on exp:withdraw", async () => {
    // Without it the phone keeps its camera on after the participant has left.
    (socket.data as Record<string, unknown>).experimentId = "exp-1";
    (socket.data as Record<string, unknown>).participantId = "part-1";
    vi.mocked(prisma.participant.update).mockResolvedValue({} as never);
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([]);
    const deviceEmit = vi.fn();
    ns.to.mockImplementation(((room: string) => ({ emit: room === "device:exp-1:part-1" ? deviceEmit : vi.fn() })) as never);

    await socket._trigger("exp:withdraw");

    expect(deviceEmit).toHaveBeenCalledWith("device:finished");
  });

  it("marks participant completed on exp:complete", async () => {
    (socket.data as Record<string, unknown>).participantId = "part-1";
    vi.mocked(prisma.participant.update).mockResolvedValue({} as never);
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([]);

    await socket._trigger("exp:complete");

    expect(prisma.participant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ completion: true }),
      }),
    );
  });

  it("confirms completion to the client so the end screen can advance", async () => {
    (socket.data as Record<string, unknown>).participantId = "part-1";
    vi.mocked(prisma.participant.update).mockResolvedValue({} as never);
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([]);

    await socket._trigger("exp:complete");

    expect(socket.emit).toHaveBeenCalledWith("exp:completed");
  });

  it("does not confirm completion when persisting fails", async () => {
    (socket.data as Record<string, unknown>).participantId = "part-1";
    vi.mocked(prisma.participant.update).mockRejectedValue(new Error("db down"));

    await socket._trigger("exp:complete");

    expect(socket.emit).not.toHaveBeenCalledWith("exp:completed");
    expect(socket.emit).toHaveBeenCalledWith(
      "error",
      expect.objectContaining({ code: "INTERNAL" }),
    );
  });
});

// ── Matching Handler Tests ─────────────────────────────

describe("matchingHandler", () => {
  let socket1: ReturnType<typeof createMockSocket>;
  let socket2: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;
  let store: InstanceType<typeof import("../socket/waitingRoomStore.js").MemoryWaitingRoomStore>;

  beforeEach(async () => {
    socket1 = createMockSocket("s1");
    socket2 = createMockSocket("s2");
    ns = createMockNamespace();

    // Create a fresh store for each test
    const { MemoryWaitingRoomStore } = await import("../socket/waitingRoomStore.js");
    store = new MemoryWaitingRoomStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("matches two participants with FIFO strategy", async () => {
    const { registerMatchingHandler } = await import("../socket/matchingHandler.js");

    const experiment = {
      id: "exp-1",
      routines: [{
        name: "video-chat-1",
        type: "routine-video-chat",
        matching: { strategy: "fifo", slots: [{ name: "player1" }, { name: "player2" }], timeout: 300, timeoutAction: "wait" },
        elements: [],
      }],
    };

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experiment as never);
    vi.mocked(prisma.session.create).mockResolvedValue({ id: "sess-1" } as never);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({ id: "p1", properties: {} } as never);
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([]);
    vi.mocked(prisma.session.update).mockResolvedValue({} as never);
    ns.fetchSockets.mockResolvedValue([]);

    // Register both sockets — set data on existing object
    socket1.data = { experimentId: "exp-1", participantId: "p1", condition: null, progress: 0 };
    socket2.data = { experimentId: "exp-1", participantId: "p2", condition: null, progress: 0 };

    registerMatchingHandler(ns as never, socket1 as never, store);
    registerMatchingHandler(ns as never, socket2 as never, store);

    // P1 joins
    await socket1._trigger("match:join", { routineName: "video-chat-1" });
    expect(socket1.emit).toHaveBeenCalledWith("match:waiting", { current: 1, target: 2 });

    vi.mocked(prisma.participant.findUnique).mockResolvedValue({ id: "p2", properties: {} } as never);

    // P2 joins — should trigger match
    await socket2._trigger("match:join", { routineName: "video-chat-1" });
    expect(prisma.session.create).toHaveBeenCalled();
  });

  it("matches participants with property-based strategy", async () => {
    const { registerMatchingHandler } = await import("../socket/matchingHandler.js");

    const experiment = {
      id: "exp-1",
      routines: [{
        name: "video-chat-1",
        type: "routine-video-chat",
        matching: {
          strategy: "property",
          slots: [
            { name: "groupA", filters: [{ property: "condition", operator: "eq", value: "A" }] },
            { name: "groupB", filters: [{ property: "condition", operator: "eq", value: "B" }] },
          ],
          timeout: 300,
          timeoutAction: "wait",
        },
        elements: [],
      }],
    };

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experiment as never);
    vi.mocked(prisma.session.create).mockResolvedValue({ id: "sess-1" } as never);
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([]);
    vi.mocked(prisma.session.update).mockResolvedValue({} as never);
    ns.fetchSockets.mockResolvedValue([]);

    vi.mocked(prisma.participant.findUnique)
      .mockResolvedValueOnce({ id: "p1", properties: { condition: "A" } } as never)
      .mockResolvedValueOnce({ id: "p2", properties: { condition: "B" } } as never);

    socket1.data = { experimentId: "exp-1", participantId: "p1", condition: "A", progress: 0 };
    socket2.data = { experimentId: "exp-1", participantId: "p2", condition: "B", progress: 0 };

    registerMatchingHandler(ns as never, socket1 as never, store);
    registerMatchingHandler(ns as never, socket2 as never, store);

    await socket1._trigger("match:join", { routineName: "video-chat-1" });
    await socket2._trigger("match:join", { routineName: "video-chat-1" });

    expect(prisma.session.create).toHaveBeenCalled();
  });
});

// ── Signaling Handler Tests ────────────────────────────

describe("signalingHandler", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;
  const toEmit = vi.fn();

  beforeEach(async () => {
    socket = createMockSocket();
    ns = createMockNamespace();
    ns.to.mockReturnValue({ emit: toEmit });

    const { registerSignalingHandler } = await import("../socket/signalingHandler.js");
    registerSignalingHandler(ns as never, socket as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("relays signal:offer to target peer", async () => {
    socket.data = { experimentId: "exp-1", participantId: "p1" };

    // Mock peers in same session
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([
      { sessionId: "sess-1" } as never,
    ]);
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue({ id: "sp-2" } as never);

    await socket._trigger("signal:offer", {
      targetPeerId: "p2",
      sdp: { type: "offer", sdp: "v=0..." },
    });

    expect(ns.to).toHaveBeenCalledWith("experiment:exp-1:p2");
    expect(toEmit).toHaveBeenCalledWith("signal:offer", expect.objectContaining({
      fromPeerId: "p1",
    }));
  });

  it("rejects signal when peers not in same session", async () => {
    socket.data = { experimentId: "exp-1", participantId: "p1" };

    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([]);

    await socket._trigger("signal:offer", {
      targetPeerId: "p2",
      sdp: { type: "offer", sdp: "v=0..." },
    });

    expect(socket.emit).toHaveBeenCalledWith("error", expect.objectContaining({
      code: "UNAUTHORIZED",
    }));
  });
});
