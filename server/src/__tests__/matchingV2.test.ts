import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import prisma from "../prisma.js";
import type { MatchingConfig } from "ame-shared";

vi.mock("../prisma.js", () => ({
  default: {
    experiment: { findUnique: vi.fn(), update: vi.fn() },
    participant: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    experimentContent: { findFirst: vi.fn() },
    experimentResult: { create: vi.fn() },
    session: { create: vi.fn(), update: vi.fn() },
    sessionParticipant: { findFirst: vi.fn(), findMany: vi.fn() },
    upload: { update: vi.fn() },
    roleAssignmentCycle: { upsert: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

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

describe("Slot-Based Matching", () => {
  let ns: ReturnType<typeof createMockNamespace>;
  let store: InstanceType<typeof import("../socket/waitingRoomStore.js").MemoryWaitingRoomStore>;

  beforeEach(async () => {
    ns = createMockNamespace();
    const { MemoryWaitingRoomStore } = await import("../socket/waitingRoomStore.js");
    store = new MemoryWaitingRoomStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("matches participants with FIFO slots (no filters)", async () => {
    const { registerMatchingHandler } = await import("../socket/matchingHandler.js");

    const experiment = {
      id: "exp-1",
      routines: [{
        name: "match-routine",
        type: "routine-card",
        matching: {
          strategy: "fifo",
          slots: [{ name: "player1" }, { name: "player2" }],
          timeout: 300,
          timeoutAction: "wait",
        },
        elements: [],
      }],
    };

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experiment as never);
    vi.mocked(prisma.session.create).mockResolvedValue({ id: "sess-1" } as never);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({ id: "p1", properties: {} } as never);
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([]);
    vi.mocked(prisma.session.update).mockResolvedValue({} as never);
    ns.fetchSockets.mockResolvedValue([]);

    const s1 = createMockSocket("s1");
    const s2 = createMockSocket("s2");
    s1.data = { experimentId: "exp-1", participantId: "p1", progress: 0 };
    s2.data = { experimentId: "exp-1", participantId: "p2", progress: 0 };

    registerMatchingHandler(ns as never, s1 as never, store);
    registerMatchingHandler(ns as never, s2 as never, store);

    await s1._trigger("match:join", { routineName: "match-routine" });
    expect(s1.emit).toHaveBeenCalledWith("match:waiting", expect.objectContaining({ current: 1, target: 2 }));

    vi.mocked(prisma.participant.findUnique).mockResolvedValue({ id: "p2", properties: {} } as never);

    await s2._trigger("match:join", { routineName: "match-routine" });

    expect(prisma.session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          experimentId: "exp-1",
          routineName: "match-routine",
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

  it("matches participants with property-based slots", async () => {
    const { registerMatchingHandler } = await import("../socket/matchingHandler.js");

    const experiment = {
      id: "exp-1",
      routines: [{
        name: "match-routine",
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
      }],
    };

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experiment as never);
    vi.mocked(prisma.session.create).mockResolvedValue({ id: "sess-1" } as never);
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([]);
    vi.mocked(prisma.session.update).mockResolvedValue({} as never);
    ns.fetchSockets.mockResolvedValue([]);

    const s1 = createMockSocket("s1");
    const s2 = createMockSocket("s2");
    s1.data = { experimentId: "exp-1", participantId: "p1", progress: 0 };
    s2.data = { experimentId: "exp-1", participantId: "p2", progress: 0 };

    vi.mocked(prisma.participant.findUnique)
      .mockResolvedValueOnce({ id: "p1", properties: { language: "english" } } as never)
      .mockResolvedValueOnce({ id: "p2", properties: { language: "spanish" } } as never);

    registerMatchingHandler(ns as never, s1 as never, store);
    registerMatchingHandler(ns as never, s2 as never, store);

    await s1._trigger("match:join", { routineName: "match-routine" });
    await s2._trigger("match:join", { routineName: "match-routine" });

    expect(prisma.session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          participants: {
            create: expect.arrayContaining([
              expect.objectContaining({ participantId: "p1", seat: 0, slotName: "native" }),
              expect.objectContaining({ participantId: "p2", seat: 1, slotName: "learner" }),
            ]),
          },
        }),
      }),
    );
  });

  it("does not match when property requirements are not met", async () => {
    const { registerMatchingHandler } = await import("../socket/matchingHandler.js");

    const experiment = {
      id: "exp-1",
      routines: [{
        name: "match-routine",
        type: "routine-card",
        matching: {
          strategy: "property",
          slots: [
            { name: "native", filters: [{ property: "language", operator: "eq", value: "english" }] },
            { name: "learner", filters: [{ property: "language", operator: "eq", value: "spanish" }] },
          ],
        },
        elements: [],
      }],
    };

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experiment as never);
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([]);
    vi.mocked(prisma.session.update).mockResolvedValue({} as never);

    const s1 = createMockSocket("s1");
    const s2 = createMockSocket("s2");
    s1.data = { experimentId: "exp-1", participantId: "p1", progress: 0 };
    s2.data = { experimentId: "exp-1", participantId: "p2", progress: 0 };

    vi.mocked(prisma.participant.findUnique)
      .mockResolvedValueOnce({ id: "p1", properties: { language: "english" } } as never)
      .mockResolvedValueOnce({ id: "p2", properties: { language: "english" } } as never);

    registerMatchingHandler(ns as never, s1 as never, store);
    registerMatchingHandler(ns as never, s2 as never, store);

    await s1._trigger("match:join", { routineName: "match-routine" });
    await s2._trigger("match:join", { routineName: "match-routine" });

    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it("closes existing active session when participant joins new matching", async () => {
    const { registerMatchingHandler } = await import("../socket/matchingHandler.js");

    const experiment = {
      id: "exp-1",
      routines: [{
        name: "match-routine",
        type: "routine-card",
        matching: { strategy: "fifo", slots: [{ name: "a" }, { name: "b" }] },
        elements: [],
      }],
    };

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experiment as never);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({ id: "p1", properties: {} } as never);

    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([
      { sessionId: "old-sess", session: { id: "old-sess", status: "ACTIVE" } },
    ] as never);
    vi.mocked(prisma.session.update).mockResolvedValue({} as never);

    const s1 = createMockSocket("s1");
    s1.data = { experimentId: "exp-1", participantId: "p1", progress: 0 };

    registerMatchingHandler(ns as never, s1 as never, store);
    await s1._trigger("match:join", { routineName: "match-routine" });

    expect(prisma.session.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "old-sess" },
        data: { status: "CLOSED" },
      }),
    );
  });

  describe("slot count guards", () => {
    function matchingWithSlots(slots: { name: string }[]): MatchingConfig {
      return {
        strategy: "fifo",
        slots,
        timeout: 300,
        timeoutAction: "wait",
      };
    }

    it("treats a config with two or more slots as matchable", async () => {
      const { slotsAreMatchable } = await import(
        "../socket/matchingHandler.js"
      );

      expect(
        slotsAreMatchable(matchingWithSlots([{ name: "a" }, { name: "b" }])),
      ).toBe(true);
      expect(
        slotsAreMatchable(
          matchingWithSlots([{ name: "a" }, { name: "b" }, { name: "c" }]),
        ),
      ).toBe(true);
    });

    it("treats an empty or single-slot config as unmatchable", async () => {
      const { slotsAreMatchable } = await import(
        "../socket/matchingHandler.js"
      );

      // The empty list is the RoutineInspector default. Unguarded it made
      // tryFifoMatch loop on `while (room.length >= 0)` with a no-op
      // splice(0, 0) — a microtask loop no test timeout can interrupt (B2).
      expect(slotsAreMatchable(matchingWithSlots([]))).toBe(false);
      expect(slotsAreMatchable(matchingWithSlots([{ name: "solo" }]))).toBe(
        false,
      );
    });

    it("treats a missing matching config as unmatchable", async () => {
      const { slotsAreMatchable } = await import(
        "../socket/matchingHandler.js"
      );

      expect(slotsAreMatchable(null)).toBe(false);
      expect(slotsAreMatchable(undefined)).toBe(false);
    });

    function experimentWithSlots(slots: { name: string }[]) {
      return {
        id: "exp-guard",
        routines: [
          {
            name: "chat",
            type: "routine-video-chat",
            matching: matchingWithSlots(slots),
            elements: [],
          },
        ],
      };
    }

    it("rejects an empty slot list without creating a session", async () => {
      const { registerMatchingHandler } = await import(
        "../socket/matchingHandler.js"
      );

      vi.mocked(prisma.experiment.findUnique).mockResolvedValue(
        experimentWithSlots([]) as never,
      );

      const s1 = createMockSocket("s-guard-1");
      s1.data = {
        experimentId: "exp-guard",
        participantId: "p-guard-1",
        progress: 0,
      };
      registerMatchingHandler(ns as never, s1 as never, store);

      await s1._trigger("match:join", { routineName: "chat" });

      expect(s1.emit).toHaveBeenCalledWith("error", {
        code: "INVALID_MATCHING",
        message: 'Routine "chat" has 0 matching slots; at least 2 are required',
      });
      expect(prisma.session.create).not.toHaveBeenCalled();
      expect(await store.getEntries("ame:match:exp-guard:chat")).toEqual([]);
    });

    it("rejects a single-slot routine before closing the participant's active session", async () => {
      const { registerMatchingHandler } = await import(
        "../socket/matchingHandler.js"
      );

      vi.mocked(prisma.experiment.findUnique).mockResolvedValue(
        experimentWithSlots([{ name: "solo" }]) as never,
      );

      const s1 = createMockSocket("s-guard-2");
      s1.data = {
        experimentId: "exp-guard",
        participantId: "p-guard-2",
        progress: 0,
      };
      registerMatchingHandler(ns as never, s1 as never, store);

      await s1._trigger("match:join", { routineName: "chat" });

      expect(s1.emit).toHaveBeenCalledWith("error", {
        code: "INVALID_MATCHING",
        message: 'Routine "chat" has 1 matching slot; at least 2 are required',
      });
      expect(prisma.session.create).not.toHaveBeenCalled();
      expect(prisma.sessionParticipant.findMany).not.toHaveBeenCalled();
    });
  });

  describe("waiting-room timeout", () => {
    /** Seconds the stranded participant waits before the room gives up. */
    const TimeoutSeconds = 1;

    function experimentWithTimeoutAction(
      timeoutAction: "wait" | "proceed",
    ): unknown {
      return {
        id: "exp-timeout",
        routines: [
          {
            name: "chat",
            type: "routine-video-chat",
            elements: [],
            matching: {
              strategy: "fifo",
              slots: [{ name: "a" }, { name: "b" }],
              timeout: TimeoutSeconds,
              timeoutAction,
            },
          },
        ],
      };
    }

    async function joinAndExpire(timeoutAction: "wait" | "proceed") {
      const { registerMatchingHandler } = await import(
        "../socket/matchingHandler.js"
      );
      vi.mocked(prisma.experiment.findUnique).mockResolvedValue(
        experimentWithTimeoutAction(timeoutAction) as never,
      );
      vi.mocked(prisma.participant.findUnique).mockResolvedValue({
        id: "p-alone",
        properties: {},
      } as never);
      vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([]);
      vi.mocked(prisma.session.update).mockResolvedValue({} as never);
      ns.fetchSockets.mockResolvedValue([]);

      const socket = createMockSocket(`s-timeout-${timeoutAction}`);
      socket.data = {
        experimentId: "exp-timeout",
        participantId: `p-alone-${timeoutAction}`,
        progress: 0,
      };
      registerMatchingHandler(ns as never, socket as never, store);
      await socket._trigger("match:join", { routineName: "chat" });
      await vi.advanceTimersByTimeAsync(TimeoutSeconds * 1000);
      return socket;
    }

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("releases a stranded participant with a dedicated timeout signal", async () => {
      const socket = await joinAndExpire("proceed");

      expect(socket.emit).toHaveBeenCalledWith("match:timeout");
      // A match:matched with an empty sessionId is indistinguishable from "no
      // session yet", which suppresses the partner-unavailable notice and
      // leaves the participant on a permanent waiting overlay.
      expect(socket.emit).not.toHaveBeenCalledWith(
        "match:matched",
        expect.anything(),
      );
    });

    it("leaves a participant waiting when the action is wait", async () => {
      const socket = await joinAndExpire("wait");

      expect(socket.emit).not.toHaveBeenCalledWith("match:timeout");
    });

    it("reports a failing handleTimeout as SERVER_TASK instead of an unhandled rejection", async () => {
      const { setErrorSink, consoleSink } = await import("../errors/reportError.js");
      const records: Array<{ source: string; experimentId: string | null; participantId: string | null; routine: string | null }> = [];
      setErrorSink((r) => records.push(r));
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const removeSpy = vi.spyOn(store, "remove").mockRejectedValueOnce(new Error("store exploded"));

      try {
        await joinAndExpire("proceed");
      } finally {
        setErrorSink(consoleSink);
        removeSpy.mockRestore();
        consoleErrorSpy.mockRestore();
      }

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        source: "SERVER_TASK",
        experimentId: "exp-timeout",
        participantId: "p-alone-proceed",
        routine: "chat",
      });
    });
  });
});

describe("Session block provenance", () => {
  let ns: ReturnType<typeof createMockNamespace>;
  let store: InstanceType<typeof import("../socket/waitingRoomStore.js").MemoryWaitingRoomStore>;

  // vitest.config.ts sets mockReset globally, so implementations are installed
  // here rather than at module scope.
  beforeEach(async () => {
    ns = createMockNamespace();
    const { MemoryWaitingRoomStore } = await import("../socket/waitingRoomStore.js");
    store = new MemoryWaitingRoomStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const DyadSlots: MatchingConfig["slots"] = [{ name: "seat-1" }, { name: "seat-2" }];

  const experimentWith = (sessionDesigns: unknown) => ({
    id: "exp-1",
    routines: [
      {
        name: "chat-match",
        type: "routine-matching",
        elements: [],
        matching: {
          strategy: "fifo",
          slots: DyadSlots,
          // 0 disables the matching timeout, so this suite arms no stray timers.
          timeout: 0,
          timeoutAction: "wait",
        },
      },
    ],
    sessionDesigns,
  });

  /** Only the four name fields `ownedRoutineNames` reads are needed here. */
  const chatBlock = {
    id: "blk-chat",
    label: "Chat block",
    matchRoutineName: "chat-match",
    trialRoutine: "chat",
    endMatchRoutineName: "chat-end-match",
    interTrialRoutine: null,
  };

  const matchTwo = async (experiment: unknown): Promise<void> => {
    const { registerMatchingHandler } = await import("../socket/matchingHandler.js");

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experiment as never);
    vi.mocked(prisma.session.create).mockResolvedValue({ id: "sess-block" } as never);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({ id: "p1", properties: {} } as never);
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([]);
    vi.mocked(prisma.session.update).mockResolvedValue({} as never);
    ns.fetchSockets.mockResolvedValue([]);

    const s1 = createMockSocket("s1");
    const s2 = createMockSocket("s2");
    s1.data = { experimentId: "exp-1", participantId: "p1", progress: 1 };
    s2.data = { experimentId: "exp-1", participantId: "p2", progress: 1 };

    registerMatchingHandler(ns as never, s1 as never, store);
    registerMatchingHandler(ns as never, s2 as never, store);

    await s1._trigger("match:join", { routineName: "chat-match" });
    await s2._trigger("match:join", { routineName: "chat-match" });
  };

  it("stamps the owning block's id on the session it creates", async () => {
    await matchTwo(experimentWith([chatBlock]));

    expect(prisma.session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          routineName: "chat-match",
          // The design's id, never its label: renaming a block must not orphan
          // the sessions it already created.
          blockId: "blk-chat",
        }),
      }),
    );
  });

  it("leaves blockId null when no block claims the matching routine", async () => {
    await matchTwo(
      experimentWith([
        {
          ...chatBlock,
          matchRoutineName: "other-match",
          trialRoutine: "other",
          endMatchRoutineName: "other-end-match",
        },
      ]),
    );

    expect(prisma.session.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ blockId: null }) }),
    );
  });

  it("leaves blockId null on an experiment that declares no session designs", async () => {
    await matchTwo(experimentWith(undefined));

    expect(prisma.session.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ blockId: null }) }),
    );
  });
});

describe("Role assignment at session formation", () => {
  let ns: ReturnType<typeof createMockNamespace>;
  let store: InstanceType<typeof import("../socket/waitingRoomStore.js").MemoryWaitingRoomStore>;

  // vitest.config.ts sets mockReset globally, so implementations are installed
  // here rather than at module scope — same pattern as the other describe
  // blocks in this file.
  beforeEach(async () => {
    ns = createMockNamespace();
    const { MemoryWaitingRoomStore } = await import("../socket/waitingRoomStore.js");
    store = new MemoryWaitingRoomStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Join two participants into a matching routine and let the cohort form. */
  async function joinTwo(
    register: typeof import("../socket/matchingHandler.js").registerMatchingHandler,
    matching: MatchingConfig,
    properties: Record<string, unknown>[] = [{}, {}],
  ) {
    const routine = { name: "task-match", type: "routine-matching", layout: { rows: [] }, elements: [], matching };
    // Every join checks for an active session to close first; an empty queue
    // means there is nothing to close.
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([]);
    for (const [i, props] of properties.entries()) {
      const socket = createMockSocket(`socket-${i + 1}`);
      socket.data = { experimentId: "exp-1", participantId: `p-${i + 1}` };
      vi.mocked(prisma.participant.findUnique).mockResolvedValue({
        id: `p-${i + 1}`, experimentId: "exp-1", properties: props,
      } as any);
      register(ns as never, socket as never, store);
      await socket._trigger("match:join", { routineName: "task-match", routine });
    }
  }

  it("persists a role index for every cohort member", async () => {
    const { registerMatchingHandler } = await import("../socket/matchingHandler.js");

    const matching: MatchingConfig = {
      strategy: "fifo",
      slots: [{ name: "director" }, { name: "matcher" }],
      assignment: { mode: "random" },
    };

    // The handler resolves the routine (and its matching config) by looking it
    // up on the experiment, not from the `match:join` payload, so the mocked
    // experiment must carry it under the same name `joinTwo` joins.
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1", sessionDesigns: [], randomization: false,
      routines: [{ name: "task-match", type: "routine-matching", elements: [], matching }],
    } as any);
    vi.mocked(prisma.session.create).mockResolvedValue({ id: "sess-1" } as any);

    await joinTwo(registerMatchingHandler, matching);

    const roleWrites = vi
      .mocked(prisma.participant.update)
      .mock.calls.filter((c) => (c[0] as any).data?.role !== undefined);

    // A random deal can land either way round, so this only pins that both
    // members are written and that the two indices are complementary. That a
    // permutation is APPLIED rather than arrival order copied is pinned by the
    // counterbalanced test below, which has one expected answer.
    expect(roleWrites).toHaveLength(2);
    const indices = roleWrites.map((c) => (c[0] as any).data.role).sort((a, b) => a - b);
    expect(indices).toEqual([0, 1]);
  });

  it("applies the counterbalanced permutation rather than arrival order", async () => {
    const { registerMatchingHandler } = await import("../socket/matchingHandler.js");

    const matching: MatchingConfig = {
      strategy: "fifo",
      slots: [{ name: "director" }, { name: "matcher" }],
      assignment: { mode: "counterbalanced", set: "rotation", order: "sequential" },
    };

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1", sessionDesigns: [], randomization: false,
      routines: [{ name: "task-match", type: "routine-matching", elements: [], matching }],
    } as any);
    vi.mocked(prisma.session.create).mockResolvedValue({ id: "sess-1" } as any);

    // One session has already been dealt, so the rotation set for two roles —
    // [[0, 1], [1, 0]] — hands this cohort its SECOND permutation. Arrival
    // order and the permutation therefore disagree, which is the whole point:
    // a regression replacing `dealRoles` with `matched.map((_, i) => i)` would
    // write 0 then 1 and fail here.
    const cycleRow = { position: 1, blockOrder: null };
    const tx = {
      roleAssignmentCycle: {
        upsert: vi.fn(async () => cycleRow),
        update: vi.fn(async () => ({})),
      },
      $queryRaw: vi.fn(async () => [cycleRow]),
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(tx));

    await joinTwo(registerMatchingHandler, matching);

    const byParticipant = new Map(
      vi
        .mocked(prisma.participant.update)
        .mock.calls.filter((c) => (c[0] as any).data?.role !== undefined)
        .map((c) => [(c[0] as any).where.id, (c[0] as any).data.role]),
    );

    expect(byParticipant.get("p-1")).toBe(1);
    expect(byParticipant.get("p-2")).toBe(0);
    // And the cycle advanced, so the next cohort does not repeat this one.
    expect(tx.roleAssignmentCycle.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ position: 2 }) }),
    );
  });

  it("uses the slot index under property matching, ignoring assignment", async () => {
    const { registerMatchingHandler } = await import("../socket/matchingHandler.js");

    const matching: MatchingConfig = {
      strategy: "property",
      slots: [
        { name: "high", filters: [{ property: "score", operator: "gt", value: 5 }] },
        { name: "low", filters: [{ property: "score", operator: "lte", value: 5 }] },
      ],
      assignment: { mode: "random" },
    };

    // See the comment in the previous test: the routine must be resolvable
    // from the mocked experiment for the handler to find its matching config.
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1", sessionDesigns: [], randomization: false,
      routines: [{ name: "task-match", type: "routine-matching", elements: [], matching }],
    } as any);
    vi.mocked(prisma.session.create).mockResolvedValue({ id: "sess-1" } as any);

    await joinTwo(registerMatchingHandler, matching, [{ score: 9 }, { score: 1 }]);

    // The filters decided placement, so the role must be the slot index — not a
    // shuffle that would put the low scorer in the high slot's role.
    const roleWrites = vi
      .mocked(prisma.participant.update)
      .mock.calls.filter((c) => (c[0] as any).data?.role !== undefined);
    const byParticipant = new Map(
      roleWrites.map((c) => [(c[0] as any).where.id, (c[0] as any).data.role]),
    );

    expect(byParticipant.get("p-1")).toBe(0);
    expect(byParticipant.get("p-2")).toBe(1);
  });
});

describe("Matching liveness under a held lease", () => {
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(() => {
    ns = createMockNamespace();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("still seats a participant who arrives while another attempt holds the lease", async () => {
    // The stranding case. One attempt takes the room's lease and reads only
    // itself; a second participant joins, is refused the lease, and gives up.
    // Unless the holder looks again after releasing, both sit in a full room
    // that nobody will ever examine.
    const { MemoryWaitingRoomStore } = await import("../socket/waitingRoomStore.js");
    const { registerMatchingHandler } = await import("../socket/matchingHandler.js");
    const type = await import("../socket/waitingRoomStore.js");

    class StoreWithMidAttemptArrival extends MemoryWaitingRoomStore {
      arrival: type.WaitingEntry | null = {
        participantId: "p2",
        socketId: "s2",
        condition: null,
        externalId: null,
        properties: {},
        joinedAt: Date.now(),
      };

      async getEntries(roomKey: string): Promise<type.WaitingEntry[]> {
        const snapshot = await super.getEntries(roomKey);
        if (!this.arrival) return snapshot;
        // Only inject while an attempt holds the lease — that is the moment
        // the second participant's own attempt would be refused.
        const lease = await this.acquireMatchLease(roomKey);
        if (lease) {
          await lease.release();
          return snapshot;
        }
        const arrival = this.arrival;
        this.arrival = null;
        await super.add(roomKey, arrival);
        return snapshot;
      }
    }

    const experiment = {
      id: "exp-1",
      routines: [
        {
          name: "match-routine",
          type: "routine-card",
          matching: {
            strategy: "fifo",
            slots: [{ name: "player1" }, { name: "player2" }],
            timeout: 300,
            timeoutAction: "wait",
          } satisfies MatchingConfig,
          elements: [],
        },
      ],
    };
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experiment as never);
    vi.mocked(prisma.session.create).mockResolvedValue({ id: "sess-1" } as never);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({ id: "p1", properties: {} } as never);
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([]);
    vi.mocked(prisma.session.update).mockResolvedValue({} as never);
    ns.fetchSockets.mockResolvedValue([]);

    const store = new StoreWithMidAttemptArrival();
    const s1 = createMockSocket("s1");
    s1.data = { experimentId: "exp-1", participantId: "p1", progress: 0 };
    registerMatchingHandler(ns as never, s1 as never, store);

    await s1._trigger("match:join", { routineName: "match-routine" });

    expect(prisma.session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          participants: {
            create: expect.arrayContaining([
              expect.objectContaining({ participantId: "p1", seat: 0 }),
              expect.objectContaining({ participantId: "p2", seat: 1 }),
            ]),
          },
        }),
      }),
    );
    expect(await store.getEntries("ame:match:exp-1:match-routine")).toHaveLength(0);
  });
});

describe("Disconnect cleanup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("survives a waiting-room failure instead of taking the server down", async () => {
    // `socket.on("disconnect", async …)` hands socket.io a promise it never
    // awaits, so a rejection here is an unhandled rejection and Node exits.
    // One participant closing a tab must not end everyone else's session.
    const { registerMatchingHandler } = await import("../socket/matchingHandler.js");
    const { MemoryWaitingRoomStore } = await import("../socket/waitingRoomStore.js");

    const store = new MemoryWaitingRoomStore();
    vi.spyOn(store, "removeFromAll").mockRejectedValue(new Error("WRONGTYPE"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const socket = createMockSocket("s1");
    socket.data = { experimentId: "exp-1", participantId: "p1" };
    registerMatchingHandler(createMockNamespace() as never, socket as never, store);

    await expect(socket._trigger("disconnect")).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalled();
  });

  it("does not unqueue the participant when their device disconnects", async () => {
    // A device socket carries the participant's participantId too (set by
    // device:connect), but it is not the participant's own connection. A phone
    // locking its screen must not remove the participant from a waiting room
    // they are still sitting in — there is no grace period here, unlike the
    // seat-drop path, so this would be unrecoverable.
    const { registerMatchingHandler } = await import("../socket/matchingHandler.js");
    const { MemoryWaitingRoomStore } = await import("../socket/waitingRoomStore.js");

    const store = new MemoryWaitingRoomStore();
    const removeFromAll = vi.spyOn(store, "removeFromAll");

    const socket = createMockSocket("device-1");
    socket.data = { experimentId: "exp-1", participantId: "p1", deviceMode: "controller" };
    registerMatchingHandler(createMockNamespace() as never, socket as never, store);

    await socket._trigger("disconnect");

    expect(removeFromAll).not.toHaveBeenCalled();
  });

  it("still unqueues a normal participant socket on disconnect", async () => {
    const { registerMatchingHandler } = await import("../socket/matchingHandler.js");
    const { MemoryWaitingRoomStore } = await import("../socket/waitingRoomStore.js");

    const store = new MemoryWaitingRoomStore();
    const removeFromAll = vi.spyOn(store, "removeFromAll");

    const socket = createMockSocket("s1");
    socket.data = { experimentId: "exp-1", participantId: "p1" };
    registerMatchingHandler(createMockNamespace() as never, socket as never, store);

    await socket._trigger("disconnect");

    expect(removeFromAll).toHaveBeenCalledWith("p1");
  });
});

describe("match:join from a participant already seated", () => {
  let ns: ReturnType<typeof createMockNamespace>;
  let store: InstanceType<typeof import("../socket/waitingRoomStore.js").MemoryWaitingRoomStore>;

  const ChatRoutine = {
    name: "chat",
    type: "routine-video-chat",
    matching: {
      strategy: "fifo",
      slots: [{ name: "A" }, { name: "B" }],
      timeoutAction: "wait",
    },
    elements: [],
  };

  const seat = (routineName: string, matchProgress: number) => ({
    seat: 0,
    slotName: "A",
    session: {
      id: "sess-1",
      routineName,
      matchProgress,
      sharedProgressSequence: null,
      participants: [
        { participantId: "p1", seat: 0, slotName: "A", status: "ACTIVE", participant: { condition: "Basic" } },
        { participantId: "p2", seat: 1, slotName: "B", status: "ACTIVE", participant: { condition: "Basic" } },
      ],
    },
  });

  beforeEach(async () => {
    ns = createMockNamespace();
    const { MemoryWaitingRoomStore } = await import("../socket/waitingRoomStore.js");
    store = new MemoryWaitingRoomStore();
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({ id: "exp-1", routines: [ChatRoutine] } as never);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({ id: "p1", properties: {} } as never);
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function join(progress: number) {
    const { registerMatchingHandler } = await import("../socket/matchingHandler.js");
    const socket = createMockSocket("s1");
    socket.data = { experimentId: "exp-1", participantId: "p1", progress };
    registerMatchingHandler(ns as never, socket as never, store);
    await socket._trigger("match:join", { routineName: "chat" });
    return socket;
  }

  it("re-sends the seat instead of closing a session formed at this step (reload)", async () => {
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue(seat("chat", 3) as never);

    const socket = await join(3);

    expect(socket.emit).toHaveBeenCalledWith("match:matched", {
      sessionId: "sess-1",
      peers: ["p2"],
      seat: 0,
      slotName: "A",
      members: [
        { participantId: "p1", seat: 0, slotName: "A" },
        { participantId: "p2", seat: 1, slotName: "B" },
      ],
    });
    expect(socket.join).toHaveBeenCalledWith("session:sess-1");
    expect(prisma.sessionParticipant.findMany).not.toHaveBeenCalled();
    expect(socket.emit).not.toHaveBeenCalledWith("match:waiting", expect.anything());
  });

  it("still closes and re-queues when the session was formed by another step", async () => {
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue(seat("chat", 1) as never);

    const socket = await join(3);

    expect(prisma.sessionParticipant.findMany).toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith("match:waiting", expect.objectContaining({ current: 1, target: 2 }));
    expect(socket.emit).not.toHaveBeenCalledWith("match:matched", expect.anything());
  });

  it("still closes and re-queues when the session was formed by another routine", async () => {
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue(seat("warmup", 3) as never);

    const socket = await join(3);

    expect(prisma.sessionParticipant.findMany).toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith("match:waiting", expect.objectContaining({ current: 1, target: 2 }));
  });
});
