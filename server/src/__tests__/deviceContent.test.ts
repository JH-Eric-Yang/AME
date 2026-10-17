import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import prisma from "../prisma.js";

vi.mock("../prisma.js", () => ({
  default: {
    experiment: { findUnique: vi.fn() },
    participant: { findUnique: vi.fn(), update: vi.fn() },
    experimentContent: { findFirst: vi.fn(), findMany: vi.fn() },
    experimentResult: { findFirst: vi.fn() },
    upload: { findFirst: vi.fn() },
    sessionParticipant: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    session: { update: vi.fn(), findUnique: vi.fn() },
    sessionGrouping: { upsert: vi.fn() },
  },
}));

function createMockSocket(id = "s1") {
  const handlers = new Map<string, Function>();
  return {
    id,
    data: {} as Record<string, unknown>,
    on: vi.fn((e: string, h: Function) => { handlers.set(e, h); }),
    emit: vi.fn(),
    join: vi.fn(),
    to: vi.fn(() => ({ emit: vi.fn() })),
    disconnect: vi.fn(),
    _trigger: (e: string, ...a: unknown[]) => handlers.get(e)?.(...a),
  };
}

/** Records what was emitted into each room. */
function createMockNamespace(roomEmits: Array<{ room: string; event: string; payload: unknown }>) {
  return {
    to: vi.fn((room: string) => ({
      emit: (event: string, payload: unknown) => { roomEmits.push({ room, event, payload }); },
    })),
    fetchSockets: vi.fn(async () => [] as unknown[]),
  };
}

const Routine = {
  name: "trial",
  type: "routine-card",
  elements: [
    { name: "prompt", type: "text", params: { content: "On the desktop" } },
    { name: "phoneNote", type: "text", params: { content: "On the phone" }, surface: "device" },
    { name: "send", type: "button", params: {}, surface: "device" },
  ],
};

describe("content delivery splits by surface", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;
  let roomEmits: Array<{ room: string; event: string; payload: unknown }>;

  beforeEach(async () => {
    roomEmits = [];
    socket = createMockSocket();
    ns = createMockNamespace(roomEmits);
    socket.data = {
      experimentId: "exp-1", participantId: "p1",
      responseId: "r1", condition: "Basic", progress: 0,
    };
    const { registerProgressHandler } = await import("../socket/progressHandler.js");
    registerProgressHandler(ns as never, socket as never);

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1", randomization: false, routines: [Routine],
    } as never);
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue({
      id: "c1", experimentId: "exp-1", progress: 0, trialNumber: 1,
      routine: "trial", content: {}, condition: "Basic", description: null,
    } as never);
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "p1", properties: {}, role: null,
    } as never);
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("sends the desktop only its own elements", async () => {
    await socket._trigger("exp:ready");

    const content = socket.emit.mock.calls.find((c) => c[0] === "exp:content");
    const names = (content![1] as { elements: Array<{ name: string }> }).elements.map((e) => e.name);
    expect(names).toEqual(["prompt"]);
  });

  it("sends the phone only its own elements, in the device room", async () => {
    await socket._trigger("exp:ready");

    const device = roomEmits.find((e) => e.event === "device:content");
    expect(device?.room).toBe("device:exp-1:p1");
    const names = (device!.payload as { elements: Array<{ name: string }> }).elements.map((e) => e.name);
    expect(names).toEqual(["phoneNote", "send"]);
  });

  it("clears the phone when a routine has no device elements", async () => {
    // Without this the previous routine's controls stay live on the handset.
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1", randomization: false,
      routines: [{ ...Routine, elements: [Routine.elements[0]] }],
    } as never);

    await socket._trigger("exp:ready");

    const device = roomEmits.find((e) => e.event === "device:content");
    expect((device!.payload as { elements: unknown[] }).elements).toEqual([]);
  });

  it("tells the phone that the study ended when the end routine is delivered", async () => {
    // The phone then turns its camera off; it does not wait for the Finish click.
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1", randomization: false,
      routines: [{ name: "trial", type: "routine-end", elements: [] }],
    } as never);

    await socket._trigger("exp:ready");

    expect(roomEmits).toContainEqual({ room: "device:exp-1:p1", event: "device:finished", payload: undefined });
  });

  it("does not end the phone on any other routine", async () => {
    await socket._trigger("exp:ready");

    expect(roomEmits.find((e) => e.event === "device:finished")).toBeUndefined();
  });

  it("never renders a device element on the desktop, but keeps it to resolve device:input", async () => {
    await socket._trigger("exp:ready");

    const content = socket.emit.mock.calls.find((c) => c[0] === "exp:content");
    const payload = content![1] as {
      elements: Array<{ name: string }>;
      deviceElements: Array<{ name: string }>;
    };
    // The desktop does not render these — they must stay out of `elements`.
    expect(payload.elements.map((e) => e.name)).not.toContain("phoneNote");
    // But it keeps them under deviceElements so a later device:input naming
    // "phoneNote" can be resolved back to the element that sent it. This is
    // not a leak: it is the participant's own phone content on their own socket.
    expect(payload.deviceElements.map((e) => e.name)).toEqual(["phoneNote", "send"]);
  });
});

describe("a phone that pairs mid-routine", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;
  let roomEmits: Array<{ room: string; event: string; payload: unknown }>;

  beforeEach(async () => {
    roomEmits = [];
    socket = createMockSocket("device-1");
    ns = createMockNamespace(roomEmits);
    const { registerSignalingHandler } = await import("../socket/signalingHandler.js");
    registerSignalingHandler(ns as never, socket as never);

    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "p1", experimentId: "exp-1", progress: 0, condition: "Basic",
      properties: {}, role: null, progressSequence: null,
    } as never);
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1", randomization: false, routines: [Routine],
    } as never);
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue({
      id: "c1", experimentId: "exp-1", progress: 0, trialNumber: 1,
      routine: "trial", content: {}, condition: "Basic", description: null,
    } as never);
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue(null as never);
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("is sent the current routine's device elements as it connects", async () => {
    // Participants pair the phone AFTER starting, so this is the normal case,
    // not an edge case: without it the handset stays blank until the next
    // routine.
    await socket._trigger("device:connect", { participantId: "p1", mode: "controller" });
    await new Promise((r) => setImmediate(r));

    const device = roomEmits.find((e) => e.event === "device:content");
    expect(device?.room).toBe("device:exp-1:p1");
    const names = (device!.payload as { elements: Array<{ name: string }> }).elements.map((e) => e.name);
    expect(names).toEqual(["phoneNote", "send"]);
  });

  it("joins the device room so later deliveries reach it", async () => {
    await socket._trigger("device:connect", { participantId: "p1", mode: "controller" });
    await new Promise((r) => setImmediate(r));

    expect(socket.join).toHaveBeenCalledWith("device:exp-1:p1");
  });

  it("applies showForRoles on the catch-up send, not just surface", async () => {
    // Regression for the brief's own naive sketch of sendDeviceContent, which
    // split by surface alone and would have handed a phone every device
    // element regardless of role. participant.role defaults to null here,
    // which resolves to roleIndex 0 -> "Director" via routine.roles[0].
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1",
      randomization: false,
      routines: [
        {
          ...Routine,
          roles: ["Director", "Matcher"],
          elements: [
            ...Routine.elements,
            {
              name: "dirPhone", type: "text",
              params: { content: "Director only" },
              surface: "device", showForRoles: ["Director"],
            },
            {
              name: "matchPhone", type: "button", params: {},
              surface: "device", showForRoles: ["Matcher"],
            },
          ],
        },
      ],
    } as never);

    await socket._trigger("device:connect", { participantId: "p1", mode: "controller" });
    await new Promise((r) => setImmediate(r));

    const device = roomEmits.find((e) => e.event === "device:content");
    const names = (device!.payload as { elements: Array<{ name: string }> }).elements.map((e) => e.name);
    expect(names).toEqual(["phoneNote", "send", "dirPhone"]);
  });
});

describe("a device that disconnects", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;
  let roomEmits: Array<{ room: string; event: string; payload: unknown }>;

  beforeEach(async () => {
    roomEmits = [];
    ns = createMockNamespace(roomEmits);
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("tells the desktop the device is gone, in the participant room device:joined uses", async () => {
    socket = createMockSocket("device-1");
    socket.data = { experimentId: "exp-1", participantId: "p1", deviceMode: "controller" };
    const { registerSignalingHandler } = await import("../socket/signalingHandler.js");
    registerSignalingHandler(ns as never, socket as never);

    await socket._trigger("disconnect");

    expect(roomEmits).toContainEqual({
      room: "experiment:exp-1:p1",
      event: "device:left",
      payload: { peerId: "device-1", mode: "controller" },
    });
  });

  it("emits nothing when a non-device (participant) socket disconnects", async () => {
    socket = createMockSocket("s1");
    socket.data = { experimentId: "exp-1", participantId: "p1" };
    const { registerSignalingHandler } = await import("../socket/signalingHandler.js");
    registerSignalingHandler(ns as never, socket as never);

    await socket._trigger("disconnect");

    expect(roomEmits.find((e) => e.event === "device:left")).toBeUndefined();
  });
});

describe("showForRoles vs. the slot-name fallback", () => {
  // A routine that declares `roles` has role assignment permute independently
  // of arrival slot: a participant sitting in slot "Director" may hold the
  // role "Matcher". When that happens, the ROLE must decide who sees a
  // showForRoles-scoped element — the slot fallback exists only for routines
  // authored before roles existed, which declare none.
  const RoleRoutine = {
    name: "trial",
    type: "routine-card",
    roles: ["Director", "Matcher"],
    elements: [
      { name: "shared", type: "text", params: { content: "Everyone" } },
      {
        name: "dirOnly",
        type: "text",
        params: { content: "Director's stimulus" },
        showForRoles: ["Director"],
      },
    ],
  };

  const NoRoleRoutine = {
    name: "trial",
    type: "routine-card",
    // No `roles` declared — an experiment authored before roles existed.
    elements: [
      { name: "shared", type: "text", params: { content: "Everyone" } },
      {
        name: "dirOnly",
        type: "text",
        params: { content: "Director's stimulus" },
        showForRoles: ["Director"],
      },
    ],
  };

  let socket: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;
  let roomEmits: Array<{ room: string; event: string; payload: unknown }>;

  beforeEach(() => {
    roomEmits = [];
    socket = createMockSocket();
    ns = createMockNamespace(roomEmits);
    socket.data = {
      experimentId: "exp-1", participantId: "p1",
      responseId: "r1", condition: "Basic", progress: 0,
    };
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("does NOT leak a role-scoped element to a participant whose SLOT matches but whose ROLE does not", async () => {
    const { registerProgressHandler } = await import("../socket/progressHandler.js");
    registerProgressHandler(ns as never, socket as never);

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1", randomization: false, routines: [RoleRoutine],
    } as never);
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue({
      id: "c1", experimentId: "exp-1", progress: 0, trialNumber: 1,
      routine: "trial", content: {}, condition: "Basic", description: null,
    } as never);
    // role index 1 -> RoleRoutine.roles[1] = "Matcher"
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "p1", properties: {}, role: 1,
    } as never);
    // ...but they arrived into the slot named "Director".
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue({
      seat: 0,
      slotName: "Director",
      session: {
        id: "sess-1", matchProgress: null, sharedProgressSequence: null,
        participants: [],
      },
    } as never);

    await socket._trigger("exp:ready");

    const content = socket.emit.mock.calls.find((c) => c[0] === "exp:content");
    const names = (content![1] as { elements: Array<{ name: string }> }).elements.map((e) => e.name);
    expect(names).toEqual(["shared"]);
  });

  it("still shows a slot-scoped element when the routine declares NO roles (backward compatibility)", async () => {
    const { registerProgressHandler } = await import("../socket/progressHandler.js");
    registerProgressHandler(ns as never, socket as never);

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1", randomization: false, routines: [NoRoleRoutine],
    } as never);
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue({
      id: "c1", experimentId: "exp-1", progress: 0, trialNumber: 1,
      routine: "trial", content: {}, condition: "Basic", description: null,
    } as never);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "p1", properties: {}, role: null,
    } as never);
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue({
      seat: 0,
      slotName: "Director",
      session: {
        id: "sess-1", matchProgress: null, sharedProgressSequence: null,
        participants: [],
      },
    } as never);

    await socket._trigger("exp:ready");

    const content = socket.emit.mock.calls.find((c) => c[0] === "exp:content");
    const names = (content![1] as { elements: Array<{ name: string }> }).elements.map((e) => e.name);
    expect(names).toEqual(["shared", "dirOnly"]);
  });
});

const RefRoutine = {
  name: "recap",
  type: "routine-card",
  elements: [
    { name: "greeting", type: "text", params: { content: "Welcome back, {{ref:self/p0/name}}" } },
    { name: "replay", type: "video", params: { src: "ref:self/p0/clip" } },
    { name: "missing", type: "text", params: { content: "[{{ref:self/p0/nothing}}]" } },
  ],
};

const EarlierRoutine = {
  name: "intro",
  type: "routine-card",
  elements: [
    { name: "name", type: "input-textfield", params: {} },
    { name: "clip", type: "recorder", params: {} },
  ],
};

describe("content delivery resolves references", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(async () => {
    socket = createMockSocket();
    ns = createMockNamespace([]);
    socket.data = {
      experimentId: "exp-1", participantId: "p1",
      responseId: "r1", condition: "Basic", progress: 1,
    };
    const { registerProgressHandler } = await import("../socket/progressHandler.js");
    registerProgressHandler(ns as never, socket as never);

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1", randomization: false, routines: [EarlierRoutine, RefRoutine],
    } as never);
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue({
      id: "c2", experimentId: "exp-1", progress: 1, trialNumber: 1,
      routine: "recap", content: {}, condition: "Basic", description: null,
    } as never);
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "p1", properties: {}, role: null,
    } as never);
    vi.mocked(prisma.experimentResult.findFirst).mockResolvedValue({
      routine: "intro", response: { name: "Ada" },
    } as never);
    vi.mocked(prisma.upload.findFirst).mockResolvedValue({
      id: "u1", status: "COMPLETE", filePath: "/srv/uploads/u1", mimeType: "video/webm",
    } as never);
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("substitutes the participant's own earlier data and lists what it could not", async () => {
    await socket._trigger("exp:ready");

    const call = socket.emit.mock.calls.find(([event]) => event === "exp:content");
    expect(call).toBeDefined();
    const payload = call![1] as { elements: Array<{ name: string; params: Record<string, unknown> }>; unresolvedRefs?: string[] };

    const byName = Object.fromEntries(payload.elements.map((e) => [e.name, e.params]));
    expect(byName.greeting.content).toBe("Welcome back, Ada");
    expect(String(byName.replay.src)).toMatch(/^\/api\/uploads\/u1\?token=/);
    expect(byName.missing.content).toBe("[]");
    expect(payload.unresolvedRefs).toEqual(["ref:self/p0/nothing"]);

    expect(prisma.experimentResult.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ participantId: "p1", progress: 0 }) }),
    );
    expect(prisma.upload.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ elementName: "clip", progress: 0 }) }),
    );
  });

  it("omits gaps from elements this participant does not receive", async () => {
    // The routine now has a Director-only element with a gap of its own, and
    // this participant holds the second role.
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1",
      randomization: false,
      routines: [
        EarlierRoutine,
        {
          ...RefRoutine,
          roles: ["Director", "Matcher"],
          elements: [
            ...RefRoutine.elements,
            {
              name: "hidden",
              type: "text",
              params: { content: "{{ref:self/p0/nothing2}}" },
              showForRoles: ["Director"],
            },
          ],
        },
      ],
    } as never);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({
      id: "p1", properties: {}, role: 1,
    } as never);

    await socket._trigger("exp:ready");

    const call = socket.emit.mock.calls.find(([event]) => event === "exp:content");
    const payload = call![1] as { unresolvedRefs?: string[] };
    expect(payload.unresolvedRefs).toEqual(["ref:self/p0/nothing"]);
  });

  it("does not query results or uploads when nothing references them", async () => {
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue({
      id: "c1", experimentId: "exp-1", progress: 1, trialNumber: 1,
      routine: "intro", content: {}, condition: "Basic", description: null,
    } as never);

    await socket._trigger("exp:ready");

    expect(prisma.experimentResult.findFirst).not.toHaveBeenCalled();
    expect(prisma.upload.findFirst).not.toHaveBeenCalled();
    const call = socket.emit.mock.calls.find(([event]) => event === "exp:content");
    expect((call![1] as { unresolvedRefs?: string[] }).unresolvedRefs).toBeUndefined();
  });
});

describe("content delivery addresses the session", () => {
  const PartnerRoutine = {
    name: "recap",
    type: "routine-card",
    elements: [{ name: "greet", type: "text", params: { content: "Hi {{ref:partner/p0/name}}" } }],
  };
  const IntroRoutine = { name: "intro", type: "routine-card", elements: [{ name: "name", type: "input-textfield", params: {} }] };
  const Members = [
    { participantId: "p1", seat: 0, slotName: "A" },
    { participantId: "p2", seat: 1, slotName: "B" },
  ];
  let socket: ReturnType<typeof createMockSocket>;

  beforeEach(async () => {
    socket = createMockSocket();
    socket.data = { experimentId: "exp-1", participantId: "p1", responseId: "r1", condition: "Basic", progress: 1 };
    const { registerProgressHandler } = await import("../socket/progressHandler.js");
    registerProgressHandler(createMockNamespace([]) as never, socket as never);

    vi.mocked(prisma.experiment.findUnique).mockResolvedValue({
      id: "exp-1", randomization: false, activeTime: 30, routines: [IntroRoutine, PartnerRoutine],
    } as never);
    vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue({
      id: "c2", experimentId: "exp-1", progress: 1, trialNumber: 1,
      routine: "recap", content: {}, condition: "Basic", description: null,
    } as never);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({ id: "p1", properties: {}, role: null } as never);
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue({
      seat: 0,
      slotName: "A",
      session: {
        id: "sess-1", matchProgress: 0, sharedProgressSequence: null,
        participants: Members.map((m) => ({ ...m, status: "ACTIVE", participant: { condition: "Basic" } })),
      },
    } as never);
    vi.mocked(prisma.experimentResult.findFirst).mockResolvedValue({ routine: "intro", response: { name: "Bo" } } as never);
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("resolves a partner reference against the session and ships the member maps", async () => {
    await socket._trigger("exp:ready");

    const call = socket.emit.mock.calls.find(([event]) => event === "exp:content");
    const payload = call![1] as {
      elements: Array<{ name: string; params: Record<string, unknown> }>;
      sessionMembers?: unknown;
      interactionGroup?: { members?: unknown; peers: string[] };
    };
    expect(payload.elements[0].params.content).toBe("Hi Bo");
    expect(prisma.experimentResult.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ participantId: "p2", progress: 0 }) }),
    );
    expect(payload.sessionMembers).toEqual(Members);
    expect(payload.interactionGroup?.members).toEqual(Members);
    expect(payload.interactionGroup?.peers).toEqual(["p2"]);
  });

  it("scopes the text channel to this step's group", async () => {
    await socket._trigger("exp:ready");
    expect(socket.data.chat).toEqual({
      key: "ame:chat:sess-1:1:0", scope: "1:0", memberIds: ["p1", "p2"], seat: 0, ttlSeconds: 1800,
    });
  });

  it("clears the text channel outside a session", async () => {
    socket.data.chat = { key: "stale", scope: "0:0", memberIds: ["p1"], seat: 0, ttlSeconds: 60 };
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue(null as never);
    await socket._trigger("exp:ready");
    expect(socket.data.chat).toBeUndefined();
  });
});

describe("a phone that pairs to a multi-capture element", () => {
  /** socket.io calls every listener of an event; keep them all, in order. */
  function createMultiListenerSocket(id: string) {
    const handlers = new Map<string, Function[]>();
    return {
      id,
      data: {} as Record<string, unknown>,
      on: vi.fn((e: string, h: Function) => { handlers.set(e, [...(handlers.get(e) ?? []), h]); }),
      emit: vi.fn(),
      join: vi.fn(),
      to: vi.fn(() => ({ emit: vi.fn() })),
      disconnect: vi.fn(),
      _trigger: (e: string, ...a: unknown[]) => Promise.all((handlers.get(e) ?? []).map((h) => h(...a))),
    };
  }

  afterEach(() => { vi.restoreAllMocks(); });

  it("is offered the open slots although its socket has no experiment yet", async () => {
    // A phone socket is new: only the participant lookup in device:connect
    // tells the server which experiment it belongs to.
    const { registerSignalingHandler } = await import("../socket/signalingHandler.js");
    const { registerDeviceSlotHandler, deviceSlotManager } = await import("../socket/deviceSlotHandler.js");
    deviceSlotManager.initSlots("exp-1:p1:reading", [
      { label: "phone", capabilities: ["camera", "microphone"], facingMode: "environment" },
    ]);
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({ experimentId: "exp-1" } as never);

    const phone = createMultiListenerSocket("phone-1");
    const ns = createMockNamespace([]);
    registerSignalingHandler(ns as never, phone as never);
    registerDeviceSlotHandler(ns as never, phone as never);

    await phone._trigger("device:connect", { participantId: "p1", mode: "camera", element: "reading" });
    await new Promise((r) => setImmediate(r));

    expect(phone.emit).toHaveBeenCalledWith("device:slots-available", {
      slots: [{ slotLabel: "phone", capabilities: ["camera", "microphone"], facingMode: "environment" }],
    });
    deviceSlotManager.cleanupSlots("exp-1:p1:reading");
  });
});

describe("device:signal between a desktop and its phone", () => {
  const Offer = { type: "offer", sdp: "v=0" };
  let roomEmits: Array<{ room: string; event: string; payload: unknown }>;
  let ns: ReturnType<typeof createMockNamespace>;

  beforeEach(() => {
    roomEmits = [];
    ns = createMockNamespace(roomEmits);
  });

  afterEach(() => { vi.restoreAllMocks(); });

  async function register(socket: ReturnType<typeof createMockSocket>) {
    const { registerSignalingHandler } = await import("../socket/signalingHandler.js");
    registerSignalingHandler(ns as never, socket as never);
  }

  it("relays a phone's offer to its desktop, named by the phone's socket id", async () => {
    // A participant alone has no session, so the call's peer check must not apply.
    const phone = createMockSocket("phone-1");
    phone.data = { experimentId: "exp-1", participantId: "p1", deviceMode: "camera" };
    const toRoom: Array<{ room: string; event: string; payload: unknown }> = [];
    phone.to = vi.fn((room: string) => ({
      emit: (event: string, payload: unknown) => { toRoom.push({ room, event, payload }); },
    })) as never;
    await register(phone);

    await phone._trigger("device:signal", { sdp: Offer });

    // socket.to(), not ns.to(): the phone is in that room too and must not hear itself.
    expect(toRoom).toEqual([
      { room: "experiment:exp-1:p1", event: "device:signal", payload: { deviceId: "phone-1", sdp: Offer } },
    ]);
    expect(phone.emit).not.toHaveBeenCalledWith("error", expect.anything());
  });

  it("relays a desktop's answer to that participant's device room only", async () => {
    const desktop = createMockSocket("desk-1");
    desktop.data = { experimentId: "exp-1", participantId: "p1" };
    await register(desktop);

    await desktop._trigger("device:signal", { deviceId: "phone-1", sdp: { type: "answer", sdp: "v=0" } });

    expect(roomEmits).toEqual([
      {
        room: "device:exp-1:p1",
        event: "device:signal",
        payload: { deviceId: "phone-1", sdp: { type: "answer", sdp: "v=0" } },
      },
    ]);
  });

  it("drops a signal from a socket that is not paired to a participant", async () => {
    const stranger = createMockSocket("x");
    await register(stranger);

    await stranger._trigger("device:signal", { deviceId: "phone-1", sdp: Offer });

    expect(roomEmits).toEqual([]);
    expect(stranger.to).not.toHaveBeenCalled();
  });
});
