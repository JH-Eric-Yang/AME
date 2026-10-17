import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import prisma from "../prisma.js";

vi.mock("../prisma.js", () => ({
  default: {
    experiment: { findUnique: vi.fn(), update: vi.fn() },
    participant: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    experimentContent: { findFirst: vi.fn(), findMany: vi.fn() },
    experimentResult: { create: vi.fn(), findFirst: vi.fn() },
    session: { create: vi.fn(), update: vi.fn() },
    sessionParticipant: { findFirst: vi.fn(), findMany: vi.fn() },
    sessionGrouping: { upsert: vi.fn() },
    upload: { update: vi.fn() },
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

describe("Property Initialization", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(async () => {
    socket = createMockSocket();
    ns = createMockNamespace();
    const { registerExperimentHandler } = await import(
      "../socket/experimentHandler.js"
    );
    registerExperimentHandler(ns as never, socket as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes properties from experiment config on new participant", async () => {
    (socket.data as Record<string, unknown>).experimentId = "exp-1";
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1",
      allowNew: true,
      conditions: ["A", "B"],
      currentCondition: null,
      rollBackTime: 60,
      activeTime: 30,
      initialProperties: { group: "control" },
      conditionProperties: { A: { role: "native" }, B: { role: "learner" } },
    } as never);
    vi.mocked(prisma.experiment.update).mockResolvedValue({} as never);
    vi.mocked(prisma.participant.create).mockResolvedValue({
      id: "part-1",
      responseId: "resp-1",
      progress: 0,
      condition: "A",
      properties: { group: "control", role: "native", condition: "A" },
    } as never);

    await socket._trigger("exp:join", {});

    expect(prisma.participant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          properties: { group: "control", role: "native", condition: "A" },
        }),
      }),
    );
  });

  it("includes properties in joined payload", async () => {
    (socket.data as Record<string, unknown>).experimentId = "exp-1";
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1",
      allowNew: true,
      conditions: [],
      currentCondition: null,
      rollBackTime: 60,
      activeTime: 30,
      initialProperties: { lang: "en" },
      conditionProperties: {},
    } as never);
    vi.mocked(prisma.participant.create).mockResolvedValue({
      id: "part-1",
      responseId: "resp-1",
      progress: 0,
      condition: null,
      properties: { lang: "en" },
    } as never);

    await socket._trigger("exp:join", {});

    expect(socket.emit).toHaveBeenCalledWith(
      "exp:joined",
      expect.objectContaining({
        properties: { lang: "en" },
      }),
    );
  });
});

describe("Property Updates on Data Events", () => {
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

  it("updates participant properties when element has setsProperty", async () => {
    (socket.data as Record<string, unknown>).experimentId = "exp-1";
    (socket.data as Record<string, unknown>).participantId = "part-1";
    (socket.data as Record<string, unknown>).responseId = "resp-1";
    (socket.data as Record<string, unknown>).progress = 2;

    vi.mocked(prisma.experimentResult.create).mockResolvedValue({} as never);
    vi.mocked(prisma.participant.update).mockResolvedValue({} as never);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "part-1",
      properties: { condition: "A" },
    } as never);
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1",
      routines: [
        { name: "consent", type: "routine-consent", elements: [] },
        { name: "survey", type: "routine-survey", elements: [] },
        {
          name: "empathy",
          type: "routine-card",
          elements: [
            { name: "empathy-slider", type: "input-slider", setsProperty: "empathy_score", params: {} },
            { name: "other-field", type: "input-textfield", params: {} },
          ],
        },
      ],
    } as never);

    await socket._trigger("exp:data", {
      progress: 2,
      trial: 1,
      routine: "empathy",
      response: { "empathy-slider": 7, "other-field": "hello" },
    });

    // Should update properties with empathy_score = 7
    expect(prisma.participant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "part-1" },
        data: expect.objectContaining({
          properties: { condition: "A", empathy_score: 7 },
        }),
      }),
    );
  });

  it("does not update properties when no element has setsProperty", async () => {
    (socket.data as Record<string, unknown>).experimentId = "exp-1";
    (socket.data as Record<string, unknown>).participantId = "part-1";
    (socket.data as Record<string, unknown>).responseId = "resp-1";
    (socket.data as Record<string, unknown>).progress = 0;

    vi.mocked(prisma.experimentResult.create).mockResolvedValue({} as never);
    vi.mocked(prisma.participant.update).mockResolvedValue({} as never);
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1",
      routines: [
        {
          name: "survey",
          type: "routine-card",
          elements: [
            { name: "q1", type: "input-textfield", params: {} },
          ],
        },
      ],
    } as never);

    await socket._trigger("exp:data", {
      progress: 0,
      trial: 1,
      routine: "survey",
      response: { q1: "answer" },
    });

    // participant.update called once for lastLogTime, no properties update
    const updateCalls = vi.mocked(prisma.participant.update).mock.calls;
    const hasPropertiesUpdate = updateCalls.some(
      (call) => "properties" in (call[0] as { data: Record<string, unknown> }).data,
    );
    expect(hasPropertiesUpdate).toBe(false);
  });
});

describe("Session-Spanning Progress Sync", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(async () => {
    socket = createMockSocket();
    ns = createMockNamespace();
    const { registerProgressHandler } = await import(
      "../socket/progressHandler.js"
    );
    registerProgressHandler(ns as never, socket as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("finds active session across routines and includes interaction group", async () => {
    (socket.data as Record<string, unknown>).experimentId = "exp-1";
    (socket.data as Record<string, unknown>).participantId = "part-1";
    (socket.data as Record<string, unknown>).progress = 3;

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1",
      routines: [
        { name: "consent", type: "routine-consent", elements: [] },
        {
          name: "matching",
          type: "routine-card",
          matching: { strategy: "fifo", slots: [{ name: "a" }, { name: "b" }] },
          elements: [],
        },
        { name: "survey", type: "routine-card", elements: [] },
        {
          name: "video-chat",
          type: "routine-video-chat",
          interactionPattern: { type: "round-robin", groupSize: 2 },
          elements: [],
        },
      ],
    } as never);

    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue({
      participantId: "part-1",
      seat: 0,
      slotName: "a",
      session: {
        id: "sess-1",
        status: "ACTIVE",
        matchProgress: 1,
        sharedProgressSequence: null,
        participants: [
          {
            participantId: "part-1",
            seat: 0,
            status: "ACTIVE",
            participant: { condition: "Basic" },
          },
          {
            participantId: "part-2",
            seat: 1,
            status: "ACTIVE",
            participant: { condition: "Basic" },
          },
        ],
      },
    } as never);

    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue({
      id: "content-3",
      experimentId: "exp-1",
      progress: 3,
      trialNumber: 1,
      routine: "video-chat",
      content: {},
      condition: "Basic",
      description: null,
    } as never);
    vi.mocked(prisma.experimentContent.findMany).mockResolvedValue([]);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "part-1",
      role: 0,
      properties: {},
    } as never);

    await socket._trigger("exp:ready");

    expect(socket.emit).toHaveBeenCalledWith(
      "exp:content",
      expect.objectContaining({
        interactionGroup: expect.objectContaining({
          seat: 0,
        }),
      }),
    );
  });
});

describe("Element Visibility with Properties", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(async () => {
    socket = createMockSocket();
    ns = createMockNamespace();
    const { registerProgressHandler } = await import(
      "../socket/progressHandler.js"
    );
    registerProgressHandler(ns as never, socket as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("filters elements by showWhen property condition", async () => {
    (socket.data as Record<string, unknown>).experimentId = "exp-1";
    (socket.data as Record<string, unknown>).participantId = "part-1";
    (socket.data as Record<string, unknown>).progress = 0;

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1",
      routines: [
        {
          name: "task",
          type: "routine-card",
          elements: [
            { name: "always-visible", type: "text", params: { content: "hi" } },
            {
              name: "native-only",
              type: "text",
              params: { content: "for natives" },
              showWhen: [{ property: "role", operator: "eq", value: "native" }],
            },
            {
              name: "learner-only",
              type: "text",
              params: { content: "for learners" },
              showWhen: [{ property: "role", operator: "eq", value: "learner" }],
            },
          ],
        },
      ],
    } as never);

    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue({
      id: "content-0",
      experimentId: "exp-1",
      progress: 0,
      trialNumber: 1,
      routine: "task",
      content: {},
      condition: "Basic",
      description: null,
    } as never);
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "part-1",
      role: 0,
      properties: { role: "native" },
    } as never);

    await socket._trigger("exp:ready");

    const contentCall = socket.emit.mock.calls.find(
      (c) => c[0] === "exp:content",
    );
    expect(contentCall).toBeDefined();
    const elements = contentCall![1].elements;
    const names = elements.map((e: { name: string }) => e.name);
    expect(names).toContain("always-visible");
    expect(names).toContain("native-only");
    expect(names).not.toContain("learner-only");
  });

  it("filters elements by showForSeats", async () => {
    (socket.data as Record<string, unknown>).experimentId = "exp-1";
    (socket.data as Record<string, unknown>).participantId = "part-1";
    (socket.data as Record<string, unknown>).progress = 0;

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1",
      routines: [
        {
          name: "task",
          type: "routine-card",
          elements: [
            { name: "for-all", type: "text", params: { content: "hi" } },
            {
              name: "seat-0-only",
              type: "text",
              params: { content: "seat 0" },
              showForSeats: [0],
            },
            {
              name: "seat-1-only",
              type: "text",
              params: { content: "seat 1" },
              showForSeats: [1],
            },
          ],
        },
      ],
    } as never);

    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue({
      id: "content-0",
      experimentId: "exp-1",
      progress: 0,
      trialNumber: 1,
      routine: "task",
      content: {},
      condition: "Basic",
      description: null,
    } as never);

    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue({
      participantId: "part-1",
      seat: 0,
      slotName: "alpha",
      session: {
        id: "sess-1",
        status: "ACTIVE",
        matchProgress: 0,
        sharedProgressSequence: null,
        participants: [
          {
            participantId: "part-1",
            seat: 0,
            status: "ACTIVE",
            participant: { condition: "Basic" },
          },
          {
            participantId: "part-2",
            seat: 1,
            status: "ACTIVE",
            participant: { condition: "Basic" },
          },
        ],
      },
    } as never);

    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "part-1",
      role: 0,
      properties: {},
    } as never);

    await socket._trigger("exp:ready");

    const contentCall = socket.emit.mock.calls.find(
      (c) => c[0] === "exp:content",
    );
    const elements = contentCall![1].elements;
    const names = elements.map((e: { name: string }) => e.name);
    expect(names).toContain("for-all");
    expect(names).toContain("seat-0-only");
    expect(names).not.toContain("seat-1-only");
  });

  it("shows an element only when an earlier answer matches its condition", async () => {
    (socket.data as Record<string, unknown>).experimentId = "exp-1";
    (socket.data as Record<string, unknown>).participantId = "part-1";
    (socket.data as Record<string, unknown>).progress = 1;

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1",
      routines: [
        { name: "intro", type: "routine-card", elements: [{ name: "answer", type: "input-textfield", params: {} }] },
        {
          name: "task",
          type: "routine-card",
          elements: [
            { name: "if-yes", type: "text", params: { content: "yes" }, showWhen: [{ property: "ref:self/p0/answer", operator: "eq", value: "yes" }] },
            { name: "if-no", type: "text", params: { content: "no" }, showWhen: [{ property: "ref:self/p0/answer", operator: "eq", value: "no" }] },
          ],
        },
      ],
    } as never);
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue({
      id: "content-1", experimentId: "exp-1", progress: 1, trialNumber: 1,
      routine: "task", content: {}, condition: "Basic", description: null,
    } as never);
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({ id: "part-1", role: 0, properties: {} } as never);
    vi.mocked(prisma.experimentResult.findFirst).mockResolvedValue({ routine: "intro", response: { answer: "yes" } } as never);

    await socket._trigger("exp:ready");

    const contentCall = socket.emit.mock.calls.find((c) => c[0] === "exp:content");
    const names = contentCall![1].elements.map((e: { name: string }) => e.name);
    expect(names).toEqual(["if-yes"]);
    expect(contentCall![1].unresolvedRefs).toBeUndefined();
  });

  it("hides an element gated on an earlier answer that does not exist", async () => {
    (socket.data as Record<string, unknown>).experimentId = "exp-1";
    (socket.data as Record<string, unknown>).participantId = "part-1";
    (socket.data as Record<string, unknown>).progress = 1;

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1",
      routines: [
        { name: "intro", type: "routine-card", elements: [{ name: "answer", type: "input-textfield", params: {} }] },
        {
          name: "task",
          type: "routine-card",
          elements: [
            { name: "if-yes", type: "text", params: { content: "yes" }, showWhen: [{ property: "ref:self/p0/answer", operator: "eq", value: "yes" }] },
            { name: "if-no", type: "text", params: { content: "no" }, showWhen: [{ property: "ref:self/p0/answer", operator: "eq", value: "no" }] },
          ],
        },
      ],
    } as never);
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue({
      id: "content-1", experimentId: "exp-1", progress: 1, trialNumber: 1,
      routine: "task", content: {}, condition: "Basic", description: null,
    } as never);
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({ id: "part-1", role: 0, properties: {} } as never);
    vi.mocked(prisma.experimentResult.findFirst).mockResolvedValue(null);

    await socket._trigger("exp:ready");

    const contentCall = socket.emit.mock.calls.find((c) => c[0] === "exp:content");
    const names = contentCall![1].elements.map((e: { name: string }) => e.name);
    expect(names).toEqual([]);
    expect(contentCall![1].unresolvedRefs).toBeUndefined();
  });
});
