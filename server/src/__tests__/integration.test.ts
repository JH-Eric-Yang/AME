import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import prisma from "../prisma.js";

vi.mock("../prisma.js", () => ({
  default: {
    experiment: { findUnique: vi.fn(), update: vi.fn() },
    participant: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    experimentContent: { findFirst: vi.fn(), findMany: vi.fn() },
    experimentResult: { create: vi.fn() },
    session: { create: vi.fn(), update: vi.fn() },
    sessionParticipant: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    sessionGrouping: { upsert: vi.fn() },
    upload: { update: vi.fn() },
  },
}));

// ── Helpers ──────────────────────────────────────────

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

function makeExperiment(overrides: Record<string, unknown> = {}) {
  return {
    id: "exp-1",
    name: "Test Experiment",
    description: "Integration test experiment",
    visible: true,
    allowNew: true,
    avCollection: false,
    bodyDetection: false,
    videoChat: false,
    supplementaryDevice: "NONE",
    participantsPerSession: 1,
    conditions: [],
    currentCondition: null,
    randomization: false,
    matchingStrategy: "FIFO",
    activeTime: 30,
    rollBackTime: 60,
    routines: [
      {
        name: "consent",
        type: "routine-consent",
        elements: [{ name: "info", type: "text", params: { content: "Agree?" } }],
      },
      {
        name: "survey",
        type: "routine-survey",
        elements: [
          { name: "q1", type: "input-slider", params: { min: 0, max: 10 } },
          { name: "next", type: "button", params: { label: "Next" }, events: [{ type: "proceed", trigger: "click" }] },
        ],
      },
      {
        name: "end",
        type: "routine-end",
        elements: [{ name: "thanks", type: "text", params: { content: "Thank you" } }],
      },
    ],
    ...overrides,
  };
}

function makeContent(overrides: Partial<{
  id: string;
  experimentId: string;
  progress: number;
  trialNumber: number;
  routine: string;
  content: Record<string, unknown>;
  condition: string;
  description: string | null;
}> = {}) {
  return {
    id: overrides.id ?? "content-1",
    experimentId: overrides.experimentId ?? "exp-1",
    progress: overrides.progress ?? 0,
    trialNumber: overrides.trialNumber ?? 1,
    routine: overrides.routine ?? "consent",
    content: overrides.content ?? {},
    condition: overrides.condition ?? "Basic",
    description: overrides.description ?? null,
  };
}

// ── E2E: Single Participant Flow ─────────────────────

describe("E2E: Single participant — consent → survey → complete", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(async () => {
    socket = createMockSocket();
    ns = createMockNamespace();

    const { registerExperimentHandler } = await import("../socket/experimentHandler.js");
    const { registerProgressHandler } = await import("../socket/progressHandler.js");
    const { registerDataHandler } = await import("../socket/dataHandler.js");

    registerExperimentHandler(ns as never, socket as never);
    registerProgressHandler(ns as never, socket as never);
    registerDataHandler(ns as never, socket as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("completes a full single-participant experiment flow", async () => {
    const experiment = makeExperiment();
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experiment as never);
    vi.mocked(prisma.experiment.update).mockResolvedValue({} as never);
    vi.mocked(prisma.participant.create).mockResolvedValue({
      id: "part-1", responseId: "resp-1", progress: 0, condition: null,
    } as never);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "part-1", role: 0,
    } as never);
    vi.mocked(prisma.participant.update).mockResolvedValue({} as never);
    vi.mocked(prisma.experimentContent.findFirst).mockImplementation((async (args: { where: { progress: number } }) => {
      const p = args.where.progress;
      if (p === 0) return makeContent({ progress: 0, routine: "consent" });
      if (p === 1) return makeContent({ progress: 1, routine: "survey" });
      if (p === 2) return makeContent({ progress: 2, routine: "end" });
      return null;
    }) as never);
    vi.mocked(prisma.experimentContent.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.experimentResult.create).mockResolvedValue({} as never);
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([]);

    // Step 1: Init experiment
    await socket._trigger("exp:init", { experimentId: "exp-1", platform: "chrome" });
    expect(socket.emit).toHaveBeenCalledWith("exp:config", expect.objectContaining({ id: "exp-1" }));

    // Step 2: Join experiment
    await socket._trigger("exp:join", {});
    expect(socket.emit).toHaveBeenCalledWith("exp:joined", expect.objectContaining({
      participantId: "part-1",
      progress: 0,
    }));

    // Step 3: Ready — get first content (consent routine at progress 0)
    await socket._trigger("exp:ready");
    expect(socket.emit).toHaveBeenCalledWith("exp:content", expect.objectContaining({
      progress: 0,
      routine: expect.objectContaining({ name: "consent", type: "routine-consent" }),
    }));

    // Step 4: Give consent
    await socket._trigger("exp:consent");
    expect(prisma.participant.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ consent: true }) }),
    );

    // Step 5: Proceed to survey (progress 0 → 1)
    await socket._trigger("exp:proceed");
    expect(socket.emit).toHaveBeenCalledWith("exp:content", expect.objectContaining({
      progress: 1,
      routine: expect.objectContaining({ name: "survey", type: "routine-survey" }),
    }));

    // Step 6: Submit data for survey
    await socket._trigger("exp:data", {
      progress: 1, trial: 1, routine: "survey", response: { q1: 7 },
    });
    expect(prisma.experimentResult.create).toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith("exp:data:ack");

    // Step 7: Proceed to end (progress 1 → 2)
    await socket._trigger("exp:proceed");
    expect(socket.emit).toHaveBeenCalledWith("exp:content", expect.objectContaining({
      progress: 2,
      routine: expect.objectContaining({ name: "end", type: "routine-end" }),
    }));

    // Step 8: Complete
    await socket._trigger("exp:complete");
    expect(prisma.participant.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ completion: true }) }),
    );
  });

  it("proceeds past all routines and gets experiment complete alert", async () => {
    const experiment = makeExperiment();
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experiment as never);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({ id: "part-1", role: 0 } as never);
    vi.mocked(prisma.participant.update).mockResolvedValue({} as never);
    vi.mocked(prisma.experimentContent.findFirst).mockImplementation((async (args: { where: { progress: number } }) => {
      if (args.where.progress === 2) return makeContent({ progress: 2, routine: "end" });
      return null; // progress 3 has no content → complete
    }) as never);
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([]);

    // Set socket data as if participant is at final routine (progress 2, content exists at 2 but not 3)
    socket.data = { experimentId: "exp-1", participantId: "part-1", responseId: "resp-1", progress: 2 };

    // Proceed from final routine → should get complete alert
    await socket._trigger("exp:proceed");

    expect(prisma.participant.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ completion: true }) }),
    );
    expect(socket.emit).toHaveBeenCalledWith("exp:alert", expect.objectContaining({
      type: "complete",
    }));
  });

  it("filters elements by participant role when routine has roles", async () => {
    const experiment = makeExperiment({
      routines: [
        {
          name: "video-chat-1",
          type: "routine-video-chat",
          roles: ["Interviewer", "Interviewee"],
          elements: [
            { name: "shared-text", type: "text", params: { content: "Hello" } },
            { name: "prompt-A", type: "text", params: { content: "Ask questions" }, showForRoles: ["Interviewer"] },
            { name: "prompt-B", type: "text", params: { content: "Answer questions" }, showForRoles: ["Interviewee"] },
          ],
        },
      ],
    });

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experiment as never);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({ id: "part-1", role: 0 } as never);
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(
      makeContent({ progress: 0, routine: "video-chat-1" }) as never,
    );
    vi.mocked(prisma.experimentContent.findMany).mockResolvedValue([] as never);

    socket.data = { experimentId: "exp-1", participantId: "part-1", progress: 0 };
    await socket._trigger("exp:ready");

    const contentCall = socket.emit.mock.calls.find((c: unknown[]) => c[0] === "exp:content");
    expect(contentCall).toBeDefined();
    const payload = contentCall![1];
    // Role 0 = "Interviewer" — should see shared-text + prompt-A, NOT prompt-B
    expect(payload.elements).toHaveLength(2);
    expect(payload.elements.map((e: { name: string }) => e.name)).toEqual(["shared-text", "prompt-A"]);
  });
});

// ── E2E: Two-Participant Matching Flow ───────────────

describe("E2E: Two participants — matching → video chat", () => {
  let socket1: ReturnType<typeof createMockSocket>;
  let socket2: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;
  let store: InstanceType<typeof import("../socket/waitingRoomStore.js").MemoryWaitingRoomStore>;

  beforeEach(async () => {
    socket1 = createMockSocket("s1");
    socket2 = createMockSocket("s2");
    ns = createMockNamespace();
    ns.fetchSockets.mockResolvedValue([]);

    // Create fresh store and clear timeouts
    const { MemoryWaitingRoomStore } = await import("../socket/waitingRoomStore.js");
    store = new MemoryWaitingRoomStore();
    const { MatchingTimeouts } = await import("../socket/matchingHandler.js");
    MatchingTimeouts.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("matches two participants and creates a session", async () => {
    const experiment = makeExperiment({
      videoChat: true,
      participantsPerSession: 2,
      routines: [
        {
          name: "consent",
          type: "routine-consent",
          elements: [],
        },
        {
          name: "video-chat-1",
          type: "routine-video-chat",
          matching: { strategy: "fifo", slots: [{ name: "player1" }, { name: "player2" }], timeout: 300, timeoutAction: "wait" },
          elements: [],
        },
        {
          name: "end",
          type: "routine-end",
          elements: [],
        },
      ],
    });

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experiment as never);
    vi.mocked(prisma.session.create).mockResolvedValue({ id: "sess-1" } as never);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({ id: "p1", properties: {} } as never);
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([]);
    vi.mocked(prisma.session.update).mockResolvedValue({} as never);

    const { registerMatchingHandler } = await import("../socket/matchingHandler.js");

    socket1.data = { experimentId: "exp-1", participantId: "p1", condition: null, progress: 0 };
    socket2.data = { experimentId: "exp-1", participantId: "p2", condition: null, progress: 0 };

    registerMatchingHandler(ns as never, socket1 as never, store);
    registerMatchingHandler(ns as never, socket2 as never, store);

    // P1 joins matching
    await socket1._trigger("match:join", { routineName: "video-chat-1" });
    expect(socket1.emit).toHaveBeenCalledWith("match:waiting", { current: 1, target: 2 });

    vi.mocked(prisma.participant.findUnique).mockResolvedValue({ id: "p2", properties: {} } as never);

    // P2 joins matching → should trigger match
    await socket2._trigger("match:join", { routineName: "video-chat-1" });

    // Verify session created with both participants
    expect(prisma.session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          experimentId: "exp-1",
          routineName: "video-chat-1",
          status: "ACTIVE",
          participants: {
            create: expect.arrayContaining([
              expect.objectContaining({ participantId: "p1", seat: 0, slotName: "player1" }),
              expect.objectContaining({ participantId: "p2", seat: 1, slotName: "player2" }),
            ]),
          },
        }),
      }),
    );
  });
});

// ── Edge Case: Disconnect During Matching ────────────

describe("Edge case: Participant disconnect during matching", () => {
  let socket1: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;
  let store: InstanceType<typeof import("../socket/waitingRoomStore.js").MemoryWaitingRoomStore>;

  beforeEach(async () => {
    socket1 = createMockSocket("s1");
    ns = createMockNamespace();
    ns.fetchSockets.mockResolvedValue([]);

    const { MemoryWaitingRoomStore } = await import("../socket/waitingRoomStore.js");
    store = new MemoryWaitingRoomStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes participant from waiting room on disconnect", async () => {
    const experiment = makeExperiment({
      routines: [{
        name: "vc",
        type: "routine-video-chat",
        matching: { strategy: "fifo", slots: [{ name: "a" }, { name: "b" }], timeout: 300, timeoutAction: "wait" },
        elements: [],
      }],
    });

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experiment as never);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({ id: "p1", properties: {} } as never);
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([]);
    vi.mocked(prisma.session.update).mockResolvedValue({} as never);

    const { registerMatchingHandler } = await import("../socket/matchingHandler.js");

    socket1.data = { experimentId: "exp-1", participantId: "p1", condition: null, progress: 0 };
    registerMatchingHandler(ns as never, socket1 as never, store);

    // P1 joins matching
    await socket1._trigger("match:join", { routineName: "vc" });
    const roomKey = "ame:match:exp-1:vc";
    const roomAfterJoin = await store.getEntries(roomKey);
    expect(roomAfterJoin.length).toBe(1);

    // P1 disconnects
    await socket1._trigger("disconnect");
    const roomAfterDisconnect = await store.getEntries(roomKey);
    expect(roomAfterDisconnect.length).toBe(0);
  });
});

// ── Edge Case: Condition Round-Robin ─────────────────

describe("Edge case: Condition round-robin assignment", () => {
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(() => {
    ns = createMockNamespace();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("assigns conditions in round-robin order", async () => {
    vi.mocked(prisma.experiment.update).mockResolvedValue({} as never);

    const assignedConditions: string[] = [];
    vi.mocked(prisma.participant.create).mockImplementation((async (args: { data: Record<string, unknown> }) => {
      assignedConditions.push(args.data.condition as string);
      return {
        id: `part-${assignedConditions.length}`,
        responseId: `resp-${assignedConditions.length}`,
        progress: 0,
        condition: args.data.condition,
      };
    }) as never);

    const { registerExperimentHandler } = await import("../socket/experimentHandler.js");

    // Simulate 3 participants joining with round-robin tracking via currentCondition
    const conditions = ["A", "B", "C"];
    let currentCondition: string | null = null;

    for (let i = 0; i < 3; i++) {
      const socket = createMockSocket(`s${i}`);
      registerExperimentHandler(ns as never, socket as never);

      // exp:init sets experimentId on state
      vi.mocked(prisma.experiment.findUnique).mockResolvedValue(makeExperiment({
        conditions,
        currentCondition,
      }) as never);

      await socket._trigger("exp:init", { experimentId: "exp-1", platform: "chrome" });

      // For join, mock with correct currentCondition
      vi.mocked(prisma.experiment.findUnique).mockResolvedValue(makeExperiment({
        conditions,
        currentCondition,
      }) as never);
      vi.mocked(prisma.participant.findFirst).mockResolvedValue(null);

      await socket._trigger("exp:join", {});

      // Simulate what the server updates — advance the pointer
      const currentIdx = currentCondition ? conditions.indexOf(currentCondition) : -1;
      const nextIdx = (currentIdx + 1) % conditions.length;
      // The server updates currentCondition to the NEXT pointer (one ahead)
      currentCondition = conditions[(nextIdx + 1) % conditions.length];
    }

    // The round-robin assigns conditions and all three are represented
    expect(assignedConditions.length).toBe(3);
    expect(new Set(assignedConditions).size).toBe(3);
    expect(assignedConditions).toContain("A");
    expect(assignedConditions).toContain("B");
    expect(assignedConditions).toContain("C");
  });
});

// ── Edge Case: Withdraw During Active Session ────────

describe("Edge case: Withdraw notifies session partners", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;
  const partnerEmit = vi.fn();

  beforeEach(async () => {
    socket = createMockSocket();
    ns = createMockNamespace();
    ns.to.mockReturnValue({ emit: partnerEmit });

    const { registerDataHandler } = await import("../socket/dataHandler.js");
    registerDataHandler(ns as never, socket as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("notifies session partners when a participant withdraws", async () => {
    socket.data = { experimentId: "exp-1", participantId: "p1" };
    vi.mocked(prisma.participant.update).mockResolvedValue({} as never);

    // P1 is in an active session with P2. dropSeatsForParticipant reads the
    // membership row's own id and every seat's status.
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([
      {
        id: "sp-p1",
        sessionId: "sess-1",
        participantId: "p1",
        seat: 0,
        status: "ACTIVE",
        session: {
          id: "sess-1",
          status: "ACTIVE",
          participants: [
            { participantId: "p1", seat: 0, status: "ACTIVE" },
            { participantId: "p2", seat: 1, status: "ACTIVE" },
          ],
        },
      },
    ] as never);
    vi.mocked(prisma.sessionParticipant.update).mockResolvedValue({} as never);
    vi.mocked(prisma.session.update).mockResolvedValue({} as never);

    await socket._trigger("exp:withdraw");

    // Should have notified p2
    expect(ns.to).toHaveBeenCalledWith("experiment:exp-1:p2");
    expect(partnerEmit).toHaveBeenCalledWith("exp:alert", expect.objectContaining({
      type: "partner-withdrawn",
    }));

    // P1's seat is released, but P2 is still active so the session runs on.
    expect(prisma.sessionParticipant.update).toHaveBeenCalledWith({
      where: { id: "sp-p1" },
      data: { status: "DROPPED", droppedAt: expect.any(Date) },
    });
    expect(prisma.session.update).not.toHaveBeenCalled();
  });
});

// ── Edge Case: Data Rejected Without Joining ─────────

describe("Edge case: Operations rejected before joining", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(async () => {
    socket = createMockSocket();
    ns = createMockNamespace();

    const { registerDataHandler } = await import("../socket/dataHandler.js");
    const { registerProgressHandler } = await import("../socket/progressHandler.js");
    registerDataHandler(ns as never, socket as never);
    registerProgressHandler(ns as never, socket as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects exp:data when not joined", async () => {
    socket.data = {}; // No experimentId, participantId

    await socket._trigger("exp:data", {
      progress: 0, trial: 1, routine: "survey", response: { q1: "yes" },
    });

    expect(socket.emit).toHaveBeenCalledWith("error", expect.objectContaining({
      code: "NOT_JOINED",
    }));
    expect(prisma.experimentResult.create).not.toHaveBeenCalled();
  });

  it("rejects exp:ready when not joined", async () => {
    socket.data = {};

    await socket._trigger("exp:ready");

    expect(socket.emit).toHaveBeenCalledWith("error", expect.objectContaining({
      code: "NOT_JOINED",
    }));
  });

  it("rejects exp:proceed when not joined", async () => {
    socket.data = {};

    await socket._trigger("exp:proceed");

    expect(socket.emit).toHaveBeenCalledWith("error", expect.objectContaining({
      code: "NOT_JOINED",
    }));
  });
});

// ── Edge Case: Duplicate Matching Join ───────────────

describe("Edge case: Duplicate match:join is ignored", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;
  let store: InstanceType<typeof import("../socket/waitingRoomStore.js").MemoryWaitingRoomStore>;

  beforeEach(async () => {
    socket = createMockSocket();
    ns = createMockNamespace();
    ns.fetchSockets.mockResolvedValue([]);

    const { MemoryWaitingRoomStore } = await import("../socket/waitingRoomStore.js");
    store = new MemoryWaitingRoomStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not add duplicate participant to waiting room", async () => {
    const experiment = makeExperiment({
      routines: [{
        name: "vc",
        type: "routine-video-chat",
        matching: { strategy: "fifo", slots: [{ name: "a" }, { name: "b" }], timeout: 300, timeoutAction: "wait" },
        elements: [],
      }],
    });

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experiment as never);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({ id: "p1", properties: {} } as never);
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([]);
    vi.mocked(prisma.session.update).mockResolvedValue({} as never);

    const { registerMatchingHandler } = await import("../socket/matchingHandler.js");

    socket.data = { experimentId: "exp-1", participantId: "p1", condition: null, progress: 0 };
    registerMatchingHandler(ns as never, socket as never, store);

    // Join twice
    await socket._trigger("match:join", { routineName: "vc" });
    await socket._trigger("match:join", { routineName: "vc" });

    const room = await store.getEntries("ame:match:exp-1:vc");
    expect(room.length).toBe(1);
  });
});

// ── Edge Case: Session Sync on Proceed ───────────────

describe("Edge case: Session sync on proceed", () => {
  let socket1: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(async () => {
    socket1 = createMockSocket("s1");
    ns = createMockNamespace();

    const { registerProgressHandler } = await import("../socket/progressHandler.js");
    registerProgressHandler(ns as never, socket1 as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("waits for all session members before proceeding", async () => {
    const experiment = makeExperiment({
      routines: [{
        name: "vc",
        type: "routine-video-chat",
        matching: { strategy: "fifo", size: 2, timeout: 300, timeoutAction: "wait" },
        elements: [],
      }],
    });

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experiment as never);

    // P1 is in a session with P2 — P2 has NOT proceeded yet
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue({
      id: "sp-1",
      session: {
        id: "sess-1",
        status: "ACTIVE",
        participants: [
          { participantId: "p1" },
          { participantId: "p2" },
        ],
      },
    } as never);

    socket1.data = { experimentId: "exp-1", participantId: "p1", responseId: "resp-1", progress: 0 };

    await socket1._trigger("exp:proceed");

    // Should NOT advance — waiting for p2
    expect(prisma.participant.update).not.toHaveBeenCalled();
  });
});

// ── Edge Case: Reconnect and Resume ──────────────────

describe("Edge case: Participant reconnect", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(async () => {
    socket = createMockSocket();
    ns = createMockNamespace();

    const { registerExperimentHandler } = await import("../socket/experimentHandler.js");
    registerExperimentHandler(ns as never, socket as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resumes participant at their saved progress on rejoin", async () => {
    const experiment = makeExperiment({ rollBackTime: 60 });
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experiment as never);

    // First call exp:init to set experimentId on the handler's state
    await socket._trigger("exp:init", { experimentId: "exp-1", platform: "chrome" });

    // Participant was at progress 2 (end routine), last active recently
    vi.mocked(prisma.participant.findFirst).mockResolvedValue({
      id: "part-1",
      responseId: "resp-1",
      progress: 2,
      condition: "A",
      lastLogTime: new Date(), // Just now
      withdraw: false,
    } as never);
    vi.mocked(prisma.participant.update).mockResolvedValue({
      id: "part-1", responseId: "resp-1", progress: 2, condition: "A",
    } as never);

    await socket._trigger("exp:join", { responseId: "resp-1" });

    // Should resume at progress 2
    expect(socket.emit).toHaveBeenCalledWith("exp:joined", expect.objectContaining({
      progress: 2,
      condition: "A",
    }));
  });

  it("rolls back participant if inactive too long", async () => {
    // rollBackTime is in minutes; 1 minute = 60000ms
    const experiment = makeExperiment({ rollBackTime: 1 });
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experiment as never);

    // First call exp:init to set experimentId on the handler's state
    await socket._trigger("exp:init", { experimentId: "exp-1", platform: "chrome" });

    // Participant was at progress 2 but last active 2 minutes ago (> 1 min rollBackTime)
    const twoMinutesAgo = new Date(Date.now() - 120_000);
    vi.mocked(prisma.participant.findFirst).mockResolvedValue({
      id: "part-1",
      responseId: "resp-1",
      progress: 2,
      condition: "A",
      lastLogTime: twoMinutesAgo,
      withdraw: false,
    } as never);
    vi.mocked(prisma.participant.update).mockResolvedValue({
      id: "part-1", responseId: "resp-1", progress: 0, condition: "A",
    } as never);

    await socket._trigger("exp:join", { responseId: "resp-1" });

    // Should roll back to progress 0
    expect(prisma.participant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ progress: 0 }),
      }),
    );
  });
});

// ── Property System + Slot Matching + Interaction Groups ──

describe("Property System + Slot Matching + Interaction Groups", () => {
  let socket1: ReturnType<typeof createMockSocket>;
  let socket2: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;
  let store: InstanceType<typeof import("../socket/waitingRoomStore.js").MemoryWaitingRoomStore>;

  const experimentWithProperties = {
    id: "exp-prop",
    name: "Property Flow Experiment",
    description: "Tests property init, property matching, and interaction groups",
    visible: true,
    allowNew: true,
    avCollection: false,
    bodyDetection: false,
    videoChat: true,
    supplementaryDevice: "NONE",
    participantsPerSession: 2,
    conditions: ["A", "B"],
    currentCondition: null as string | null,
    randomization: false,
    matchingStrategy: "PROPERTY",
    activeTime: 30,
    rollBackTime: 60,
    initialProperties: { group: "default" },
    conditionProperties: {
      A: { language: "english" },
      B: { language: "spanish" },
    },
    routines: [
      {
        name: "consent",
        type: "routine-consent",
        elements: [{ name: "info", type: "text", params: { content: "Consent" } }],
      },
      {
        name: "matching",
        type: "routine-card",
        matching: {
          strategy: "property",
          slots: [
            { name: "native", filters: [{ property: "language", operator: "eq", value: "english" }] },
            { name: "learner", filters: [{ property: "language", operator: "eq", value: "spanish" }] },
          ],
          timeout: 300,
          timeoutAction: "wait",
        },
        elements: [],
      },
      {
        name: "video-chat",
        type: "routine-video-chat",
        interactionPattern: { type: "round-robin", groupSize: 2 },
        elements: [
          { name: "shared-prompt", type: "text", params: { content: "Discuss" } },
          {
            name: "native-instructions",
            type: "text",
            params: { content: "Speak naturally" },
            showWhen: [{ property: "language", operator: "eq", value: "english" }],
          },
          {
            name: "learner-instructions",
            type: "text",
            params: { content: "Practice speaking" },
            showWhen: [{ property: "language", operator: "eq", value: "spanish" }],
          },
        ],
      },
    ],
  };

  beforeEach(async () => {
    socket1 = createMockSocket("s-prop-1");
    socket2 = createMockSocket("s-prop-2");
    ns = createMockNamespace();
    ns.fetchSockets.mockResolvedValue([]);

    const { MemoryWaitingRoomStore } = await import("../socket/waitingRoomStore.js");
    store = new MemoryWaitingRoomStore();
    const { MatchingTimeouts } = await import("../socket/matchingHandler.js");
    MatchingTimeouts.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("full flow: init properties → match by property → content with interaction group", async () => {
    const { registerExperimentHandler } = await import("../socket/experimentHandler.js");
    const { registerProgressHandler } = await import("../socket/progressHandler.js");
    const { registerDataHandler } = await import("../socket/dataHandler.js");
    const { registerMatchingHandler } = await import("../socket/matchingHandler.js");

    // Register all handlers for both sockets
    registerExperimentHandler(ns as never, socket1 as never);
    registerProgressHandler(ns as never, socket1 as never);
    registerDataHandler(ns as never, socket1 as never);
    registerMatchingHandler(ns as never, socket1 as never, store);

    registerExperimentHandler(ns as never, socket2 as never);
    registerProgressHandler(ns as never, socket2 as never);
    registerDataHandler(ns as never, socket2 as never);
    registerMatchingHandler(ns as never, socket2 as never, store);

    // ── Step 1: Both init ──

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experimentWithProperties as never);

    await socket1._trigger("exp:init", { experimentId: "exp-prop", platform: "chrome" });
    expect(socket1.emit).toHaveBeenCalledWith("exp:config", expect.objectContaining({ id: "exp-prop" }));

    await socket2._trigger("exp:init", { experimentId: "exp-prop", platform: "chrome" });
    expect(socket2.emit).toHaveBeenCalledWith("exp:config", expect.objectContaining({ id: "exp-prop" }));

    // ── Step 2: P1 joins → gets condition A (language: english) ──

    // For P1 join: currentCondition is null → assigns condition A, advances pointer to B
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      ...experimentWithProperties,
      currentCondition: null,
    } as never);
    vi.mocked(prisma.experiment.update).mockResolvedValue({} as never);
    vi.mocked(prisma.participant.findFirst).mockResolvedValue(null); // new participant
    vi.mocked(prisma.participant.create).mockResolvedValue({
      id: "p-prop-1",
      responseId: "resp-prop-1",
      progress: 0,
      condition: "A",
      properties: { group: "default", language: "english", condition: "A" },
    } as never);

    await socket1._trigger("exp:join", {});
    expect(socket1.emit).toHaveBeenCalledWith("exp:joined", expect.objectContaining({
      participantId: "p-prop-1",
      condition: "A",
      properties: { group: "default", language: "english", condition: "A" },
    }));

    // ── Step 3: P2 joins → gets condition B (language: spanish) ──

    // After P1 joined, currentCondition advanced to B. P2 gets B, pointer goes to A.
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      ...experimentWithProperties,
      currentCondition: "B",
    } as never);
    vi.mocked(prisma.participant.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.participant.create).mockResolvedValue({
      id: "p-prop-2",
      responseId: "resp-prop-2",
      progress: 0,
      condition: "B",
      properties: { group: "default", language: "spanish", condition: "B" },
    } as never);

    await socket2._trigger("exp:join", {});
    expect(socket2.emit).toHaveBeenCalledWith("exp:joined", expect.objectContaining({
      participantId: "p-prop-2",
      condition: "B",
      properties: { group: "default", language: "spanish", condition: "B" },
    }));

    // ── Step 4: Both get consent content (progress 0) ──

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experimentWithProperties as never);
    // Content rows drive the experiment sequence for all conditions
    vi.mocked(prisma.experimentContent.findFirst).mockImplementation((async (args: { where: { progress: number; condition?: string } }) => {
      const p = args.where.progress;
      if (p === 0) return makeContent({ experimentId: "exp-prop", progress: 0, routine: "consent", condition: args.where.condition ?? "Basic" });
      if (p === 1) return makeContent({ experimentId: "exp-prop", progress: 1, routine: "matching", condition: args.where.condition ?? "Basic" });
      if (p === 2) return makeContent({ experimentId: "exp-prop", progress: 2, routine: "video-chat", condition: args.where.condition ?? "Basic" });
      return null;
    }) as never);
    vi.mocked(prisma.experimentContent.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue(null); // no active session yet
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "p-prop-1", role: 0,
      properties: { group: "default", language: "english", condition: "A" },
    } as never);

    await socket1._trigger("exp:ready");
    expect(socket1.emit).toHaveBeenCalledWith("exp:content", expect.objectContaining({
      progress: 0,
      routine: expect.objectContaining({ name: "consent", type: "routine-consent" }),
    }));

    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "p-prop-2", role: 0,
      properties: { group: "default", language: "spanish", condition: "B" },
    } as never);

    await socket2._trigger("exp:ready");
    expect(socket2.emit).toHaveBeenCalledWith("exp:content", expect.objectContaining({
      progress: 0,
      routine: expect.objectContaining({ name: "consent", type: "routine-consent" }),
    }));

    // ── Step 5: Both proceed from consent to matching (progress 0 → 1) ──

    vi.mocked(prisma.participant.update).mockResolvedValue({} as never);
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue(null); // no session sync at consent

    await socket1._trigger("exp:proceed");
    expect(socket1.emit).toHaveBeenCalledWith("exp:content", expect.objectContaining({
      progress: 1,
      routine: expect.objectContaining({ name: "matching", type: "routine-card" }),
    }));

    await socket2._trigger("exp:proceed");
    expect(socket2.emit).toHaveBeenCalledWith("exp:content", expect.objectContaining({
      progress: 1,
      routine: expect.objectContaining({ name: "matching", type: "routine-card" }),
    }));

    // ── Step 6: Both emit match:join → property matching ──

    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([]); // no prior sessions
    vi.mocked(prisma.session.update).mockResolvedValue({} as never);

    // P1 has language=english → will match native slot
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "p-prop-1", properties: { group: "default", language: "english", condition: "A" },
    } as never);

    await socket1._trigger("match:join", { routineName: "matching" });
    expect(socket1.emit).toHaveBeenCalledWith("match:waiting", { current: 1, target: 2 });

    // P2 has language=spanish → will match learner slot → triggers match
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "p-prop-2", properties: { group: "default", language: "spanish", condition: "B" },
    } as never);
    vi.mocked(prisma.session.create).mockResolvedValue({ id: "sess-prop-1" } as never);

    await socket2._trigger("match:join", { routineName: "matching" });

    // Verify session created with correct slot assignments
    expect(prisma.session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          experimentId: "exp-prop",
          routineName: "matching",
          status: "ACTIVE",
          participants: {
            create: expect.arrayContaining([
              expect.objectContaining({ participantId: "p-prop-1", seat: 0, slotName: "native" }),
              expect.objectContaining({ participantId: "p-prop-2", seat: 1, slotName: "learner" }),
            ]),
          },
        }),
      }),
    );

    // ── Step 7: Both proceed to video-chat (progress 1 → 2) ──
    // Mock sessionParticipant.findFirst to return null during proceed (bypass sync for this test)
    // The session sync flow is tested separately in its own describe block.
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.participant.update).mockResolvedValue({} as never);

    // Reset experiment mock for proceed + deliverContent
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experimentWithProperties as never);

    // For P1's proceed → deliverContent at progress 2:
    // findUnique for participant (inside deliverContent)
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "p-prop-1", role: 0,
      properties: { group: "default", language: "english", condition: "A" },
    } as never);

    await socket1._trigger("exp:proceed");
    expect(socket1.emit).toHaveBeenCalledWith("exp:content", expect.objectContaining({
      progress: 2,
      routine: expect.objectContaining({ name: "video-chat", type: "routine-video-chat" }),
    }));

    // P1 at video-chat with no session info (findFirst was null) — no interactionGroup
    // Let's verify the elements were filtered by showWhen for P1
    const p1ContentCall = socket1.emit.mock.calls.filter(
      (c: unknown[]) => c[0] === "exp:content" && (c[1] as { progress: number }).progress === 2,
    );
    expect(p1ContentCall).toHaveLength(1);
    const p1Elements = (p1ContentCall[0][1] as { elements: { name: string }[] }).elements;
    const p1ElementNames = p1Elements.map((e) => e.name);
    // P1 has language=english → sees shared-prompt + native-instructions, NOT learner-instructions
    expect(p1ElementNames).toContain("shared-prompt");
    expect(p1ElementNames).toContain("native-instructions");
    expect(p1ElementNames).not.toContain("learner-instructions");

    // For P2's proceed → deliverContent at progress 2:
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "p-prop-2", role: 0,
      properties: { group: "default", language: "spanish", condition: "B" },
    } as never);

    await socket2._trigger("exp:proceed");

    const p2ContentCall = socket2.emit.mock.calls.filter(
      (c: unknown[]) => c[0] === "exp:content" && (c[1] as { progress: number }).progress === 2,
    );
    expect(p2ContentCall).toHaveLength(1);
    const p2Elements = (p2ContentCall[0][1] as { elements: { name: string }[] }).elements;
    const p2ElementNames = p2Elements.map((e) => e.name);
    // P2 has language=spanish → sees shared-prompt + learner-instructions, NOT native-instructions
    expect(p2ElementNames).toContain("shared-prompt");
    expect(p2ElementNames).toContain("learner-instructions");
    expect(p2ElementNames).not.toContain("native-instructions");
  });

  it("delivers interaction group with correct peers at video-chat routine", async () => {
    const { registerProgressHandler } = await import("../socket/progressHandler.js");

    registerProgressHandler(ns as never, socket1 as never);
    registerProgressHandler(ns as never, socket2 as never);

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experimentWithProperties as never);
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(
      makeContent({ experimentId: "exp-prop", progress: 2, routine: "video-chat" }) as never,
    );
    vi.mocked(prisma.experimentContent.findMany).mockResolvedValue([] as never);

    // P1 is at progress 2 (video-chat) with an active session from matching at progress 1
    socket1.data = { experimentId: "exp-prop", participantId: "p-prop-1", progress: 2 };
    socket2.data = { experimentId: "exp-prop", participantId: "p-prop-2", progress: 2 };

    // Mock active session for P1 — matched at progress 1 (matching routine)
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue({
      participantId: "p-prop-1",
      seat: 0,
      slotName: "native",
      session: {
        id: "sess-prop-1",
        status: "ACTIVE",
        matchProgress: 1,
        participants: [
          {
            participantId: "p-prop-1",
            seat: 0,
            status: "ACTIVE",
            participant: { condition: "Basic" },
          },
          {
            participantId: "p-prop-2",
            seat: 1,
            status: "ACTIVE",
            participant: { condition: "Basic" },
          },
        ],
      },
    } as never);

    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "p-prop-1", role: 0,
      properties: { group: "default", language: "english", condition: "A" },
    } as never);

    await socket1._trigger("exp:ready");

    const p1Content = socket1.emit.mock.calls.find(
      (c: unknown[]) => c[0] === "exp:content",
    );
    expect(p1Content).toBeDefined();
    const p1Payload = p1Content![1] as {
      interactionGroup?: { peers: string[]; seat: number; groupIndex: number };
    };

    // P1 should have interaction group with P2 as peer
    expect(p1Payload.interactionGroup).toBeDefined();
    expect(p1Payload.interactionGroup!.seat).toBe(0);
    expect(p1Payload.interactionGroup!.peers).toEqual(["p-prop-2"]);
    expect(p1Payload.interactionGroup!.groupIndex).toBe(0);

    // Now check P2's content
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue({
      participantId: "p-prop-2",
      seat: 1,
      slotName: "learner",
      session: {
        id: "sess-prop-1",
        status: "ACTIVE",
        matchProgress: 1,
        participants: [
          {
            participantId: "p-prop-1",
            seat: 0,
            status: "ACTIVE",
            participant: { condition: "Basic" },
          },
          {
            participantId: "p-prop-2",
            seat: 1,
            status: "ACTIVE",
            participant: { condition: "Basic" },
          },
        ],
      },
    } as never);

    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "p-prop-2", role: 0,
      properties: { group: "default", language: "spanish", condition: "B" },
    } as never);

    await socket2._trigger("exp:ready");

    const p2Content = socket2.emit.mock.calls.find(
      (c: unknown[]) => c[0] === "exp:content",
    );
    expect(p2Content).toBeDefined();
    const p2Payload = p2Content![1] as {
      interactionGroup?: { peers: string[]; seat: number; groupIndex: number };
    };

    // P2 should have interaction group with P1 as peer
    expect(p2Payload.interactionGroup).toBeDefined();
    expect(p2Payload.interactionGroup!.seat).toBe(1);
    expect(p2Payload.interactionGroup!.peers).toEqual(["p-prop-1"]);
    expect(p2Payload.interactionGroup!.groupIndex).toBe(0);
  });
});

// ── Content-Driven Experiment Flow ──────────────────

describe("Content-driven experiment flow", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(async () => {
    socket = createMockSocket();
    ns = createMockNamespace();

    const { registerProgressHandler } = await import("../socket/progressHandler.js");
    const { registerDataHandler } = await import("../socket/dataHandler.js");
    registerProgressHandler(ns as never, socket as never);
    registerDataHandler(ns as never, socket as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delivers routine based on content row, not routines array index", async () => {
    const experiment = makeExperiment({
      routines: [
        {
          name: "consent",
          type: "routine-consent",
          elements: [{ name: "info", type: "text", params: { content: "Agree?" } }],
        },
        {
          name: "card",
          type: "routine-card",
          elements: [{ name: "prompt", type: "text", params: { content: "Default prompt" } }],
        },
      ],
    });

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experiment as never);
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue({
      id: "content-1",
      experimentId: "exp-1",
      progress: 0,
      trialNumber: 1,
      routine: "card",
      content: { prompt: { content: "What do you see?" } },
      condition: "Basic",
      description: null,
    } as never);
    vi.mocked(prisma.experimentContent.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "part-1", role: 0, properties: {},
    } as never);
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue(null);

    socket.data = { experimentId: "exp-1", participantId: "part-1", progress: 0, condition: null };
    await socket._trigger("exp:ready");

    const contentCall = socket.emit.mock.calls.find((c: unknown[]) => c[0] === "exp:content");
    expect(contentCall).toBeDefined();
    const payload = contentCall![1];
    expect(payload.routine.name).toBe("card");
    expect(payload.routine.type).toBe("routine-card");
  });

  it("merges content params over element default params", async () => {
    const experiment = makeExperiment({
      routines: [
        {
          name: "card",
          type: "routine-card",
          elements: [
            { name: "prompt", type: "text", params: { content: "Default prompt", fontSize: "16px" } },
            { name: "next", type: "button", params: { label: "Next" } },
          ],
        },
      ],
    });

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experiment as never);
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue({
      id: "content-1",
      experimentId: "exp-1",
      progress: 0,
      trialNumber: 1,
      routine: "card",
      content: { prompt: { content: "What color is the sky?" } },
      condition: "Basic",
      description: null,
    } as never);
    vi.mocked(prisma.experimentContent.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "part-1", role: 0, properties: {},
    } as never);
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue(null);

    socket.data = { experimentId: "exp-1", participantId: "part-1", progress: 0, condition: null };
    await socket._trigger("exp:ready");

    const contentCall = socket.emit.mock.calls.find((c: unknown[]) => c[0] === "exp:content");
    const payload = contentCall![1];
    const promptEl = payload.elements.find((e: { name: string }) => e.name === "prompt");
    expect(promptEl.params.content).toBe("What color is the sky?");
    expect(promptEl.params.fontSize).toBe("16px");
    const nextEl = payload.elements.find((e: { name: string }) => e.name === "next");
    expect(nextEl.params.label).toBe("Next");
  });

  it("emits experiment complete when no content row exists for progress", async () => {
    const experiment = makeExperiment({
      routines: [
        { name: "card", type: "routine-card", elements: [] },
      ],
    });

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experiment as never);
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "part-1", role: 0, properties: {},
    } as never);

    socket.data = { experimentId: "exp-1", participantId: "part-1", progress: 0, condition: null };
    await socket._trigger("exp:ready");

    expect(socket.emit).toHaveBeenCalledWith("exp:alert", expect.objectContaining({
      type: "complete",
    }));
  });

  it("completes experiment on proceed when no content exists for next progress", async () => {
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(makeExperiment() as never);
    vi.mocked(prisma.participant.update).mockResolvedValue({} as never);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "part-1", role: 0, properties: {}, progressSequence: null,
    } as never);
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([]);
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(null);

    socket.data = { experimentId: "exp-1", participantId: "part-1", responseId: "resp-1", progress: 0, condition: null };
    await socket._trigger("exp:proceed");

    expect(prisma.participant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ completion: true }),
      }),
    );
    expect(socket.emit).toHaveBeenCalledWith("exp:alert", expect.objectContaining({
      type: "complete",
    }));
  });

  it("emits error when content references a non-existent routine name", async () => {
    const experiment = makeExperiment({
      routines: [
        { name: "card", type: "routine-card", elements: [] },
      ],
    });

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experiment as never);
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(
      makeContent({ progress: 0, routine: "nonexistent-routine" }) as never,
    );

    socket.data = { experimentId: "exp-1", participantId: "part-1", progress: 0, condition: null };
    await socket._trigger("exp:ready");

    expect(socket.emit).toHaveBeenCalledWith("error", expect.objectContaining({
      code: "INVALID_CONTENT",
    }));
  });

  it("setsProperty uses routine from data event name, not routines array index", async () => {
    const experiment = makeExperiment({
      routines: [
        { name: "consent", type: "routine-consent", elements: [] },
        {
          name: "survey",
          type: "routine-card",
          elements: [
            { name: "mood", type: "input-slider", params: { min: 0, max: 10 }, setsProperty: "moodScore" },
          ],
        },
      ],
    });

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experiment as never);
    vi.mocked(prisma.experimentResult.create).mockResolvedValue({} as never);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "part-1", properties: {},
    } as never);
    vi.mocked(prisma.participant.update).mockResolvedValue({} as never);

    socket.data = { experimentId: "exp-1", participantId: "part-1", responseId: "resp-1", progress: 0, condition: null };
    await socket._trigger("exp:data", {
      progress: 0, trial: 1, routine: "survey", response: { mood: 7 },
    });

    expect(prisma.participant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          properties: expect.objectContaining({ moodScore: 7 }),
        }),
      }),
    );
  });
});

// ── Survey answer to role to delivered screen ────────

/**
 * Drive a matched pair all the way through: match them, take the role indices
 * matching persisted, then deliver the next routine to each and collect what
 * they received.
 */
async function runMatchedPairThroughRoutines(
  routines: Record<string, unknown>[],
  people: { id: string; properties: Record<string, unknown> }[],
): Promise<Map<string, { name: string }[]>> {
  const { registerMatchingHandler } = await import("../socket/matchingHandler.js");
  const { registerProgressHandler } = await import("../socket/progressHandler.js");
  const { MemoryWaitingRoomStore } = await import("../socket/waitingRoomStore.js");

  const experiment = makeExperiment({ routines, participantsPerSession: 2 });
  vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experiment as never);
  vi.mocked(prisma.session.create).mockResolvedValue({ id: "sess-1" } as never);
  vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(
    makeContent({ progress: 1, routine: "task" }) as never,
  );
  vi.mocked(prisma.experimentContent.findMany).mockResolvedValue([] as never);
  // closeActiveSessions iterates this unconditionally on every match:join; an
  // unmocked call returns undefined and throws into a catch block that
  // silently swallows it.
  vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([] as never);

  const store = new MemoryWaitingRoomStore();
  const ns = createMockNamespace();
  const sockets = new Map<string, ReturnType<typeof createMockSocket>>();

  // Match them. Each participant's properties decide their slot.
  for (const [i, person] of people.entries()) {
    const socket = createMockSocket(`socket-${i + 1}`);
    socket.data = { experimentId: "exp-1", participantId: person.id, progress: 0 };
    sockets.set(person.id, socket);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: person.id, experimentId: "exp-1", properties: person.properties, role: 0,
    } as never);
    registerMatchingHandler(ns as never, socket as never, store);
    await socket._trigger("match:join", {
      routineName: "task-match",
      routine: routines[0],
    });
  }

  // The roles matching just wrote. This is the join under test: delivery must
  // use these, not a hardcoded 0.
  const persisted = new Map<string, number>(
    vi
      .mocked(prisma.participant.update)
      .mock.calls.filter((c) => (c[0] as never as { data: { role?: number } }).data.role !== undefined)
      .map((c) => {
        const arg = c[0] as never as { where: { id: string }; data: { role: number } };
        return [arg.where.id, arg.data.role];
      }),
  );

  const delivered = new Map<string, { name: string }[]>();
  for (const person of people) {
    const socket = sockets.get(person.id)!;
    socket.emit.mockClear();
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: person.id, experimentId: "exp-1", properties: person.properties,
      role: persisted.get(person.id) ?? 0,
    } as never);
    socket.data = { experimentId: "exp-1", participantId: person.id, progress: 1 };
    registerProgressHandler(ns as never, socket as never, store);
    await socket._trigger("exp:ready");

    const call = socket.emit.mock.calls.find((c: unknown[]) => c[0] === "exp:content");
    const payload = call?.[1] as { elements: { name: string }[] } | undefined;
    delivered.set(person.id, payload?.elements ?? []);
  }

  return delivered;
}

describe("Survey answer drives role, role drives the screen", () => {
  it("delivers each participant only their own role's elements", async () => {
    // A survey element wrote `score` into each participant's properties via
    // setsProperty in an earlier routine; the matching routine's slot filters
    // then place them, and the slot index becomes the role index.
    const routines = [
      {
        name: "task-match",
        type: "routine-matching",
        layout: { rows: [] },
        elements: [],
        matching: {
          strategy: "property",
          slots: [
            { name: "director", filters: [{ property: "score", operator: "gt", value: 5 }] },
            { name: "matcher", filters: [{ property: "score", operator: "lte", value: 5 }] },
          ],
        },
      },
      {
        name: "task",
        type: "routine-card",
        layout: { rows: [{ columns: [{ span: 12 }] }] },
        roles: ["Director", "Matcher"],
        elements: [
          { name: "target", type: "image", params: {}, showForRoles: ["Director"] },
          { name: "options", type: "input-option-group", params: {}, showForRoles: ["Matcher"] },
          { name: "call", type: "video-chat", params: {} },
        ],
      },
    ];

    const delivered = await runMatchedPairThroughRoutines(routines, [
      { id: "p-1", properties: { score: 9 } },
      { id: "p-2", properties: { score: 1 } },
    ]);

    const director = delivered.get("p-1")!.map((e) => e.name);
    const matcher = delivered.get("p-2")!.map((e) => e.name);

    // Each sees their own element plus the shared one, and never the other's.
    expect(director).toEqual(["target", "call"]);
    expect(matcher).toEqual(["options", "call"]);
  });
});

// ── Randomized Experiment Flow ───────────────────────

describe("Randomized experiment flow", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(async () => {
    socket = createMockSocket();
    ns = createMockNamespace();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delivers content in randomized order based on progressSequence", async () => {
    const experiment = makeExperiment({
      randomization: true,
      randomizationConfig: {
        Basic: [{ fromTrial: 1, toTrial: 2, method: "latin-square" }],
      },
      routines: [
        { name: "consent", type: "routine-consent", elements: [{ name: "info", type: "text", params: { content: "Agree?" } }] },
        { name: "task-a", type: "routine-card", elements: [{ name: "prompt", type: "text", params: { content: "Task A" } }] },
        { name: "task-b", type: "routine-card", elements: [{ name: "prompt", type: "text", params: { content: "Task B" } }] },
        { name: "end", type: "routine-end", elements: [{ name: "thanks", type: "text", params: { content: "Done" } }] },
      ],
    });

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experiment as never);
    // Participant has progressSequence that swaps trial 1 and 2
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "part-1",
      role: 0,
      properties: {},
      progressSequence: [0, 2, 1, 3], // trial 1↔2 swapped
    } as never);
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue(null);

    // Content at mapped progress 2 is task-b
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(
      makeContent({ progress: 2, trialNumber: 2, routine: "task-b" }) as never,
    );
    // findMany returns all content rows (for detectMatchingPeriods)
    vi.mocked(prisma.experimentContent.findMany).mockResolvedValue([
      makeContent({ progress: 0, trialNumber: 0, routine: "consent" }),
      makeContent({ progress: 1, trialNumber: 1, routine: "task-a" }),
      makeContent({ progress: 2, trialNumber: 2, routine: "task-b" }),
      makeContent({ progress: 3, trialNumber: 3, routine: "end" }),
    ] as never);

    const { registerProgressHandler } = await import("../socket/progressHandler.js");
    registerProgressHandler(ns as never, socket as never);

    // Virtual progress 1 → content progress 2 (task-b) due to sequence [0,2,1,3]
    socket.data = { experimentId: "exp-1", participantId: "part-1", progress: 1, condition: null };
    await socket._trigger("exp:ready");

    const contentCall = socket.emit.mock.calls.find((c: unknown[]) => c[0] === "exp:content");
    expect(contentCall).toBeDefined();
    expect(contentCall![1].routine.name).toBe("task-b");
  });
});
