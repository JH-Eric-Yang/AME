import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import prisma from "../prisma.js";

vi.mock("../prisma.js", () => ({
  default: {
    experiment: { findUnique: vi.fn(), update: vi.fn() },
    participant: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

function createMockSocket() {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  return {
    id: "socket-1",
    data: {} as Record<string, unknown>,
    on: vi.fn((event: string, handler: (...args: never[]) => unknown) => {
      handlers.set(event, handler);
    }),
    emit: vi.fn(),
    join: vi.fn(),
    to: vi.fn(() => ({ emit: vi.fn() })),
    disconnect: vi.fn(),
    _trigger: (event: string, ...args: unknown[]) =>
      handlers.get(event)?.(...(args as never[])),
  };
}

const createMockNamespace = () => ({
  to: vi.fn(() => ({ emit: vi.fn() })),
  fetchSockets: vi.fn(async () => []),
});

/** An experiment that names a recruitment id parameter. */
function experimentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "exp-1",
    allowNew: true,
    participantIdParam: "PID",
    conditions: [],
    currentCondition: null,
    randomization: false,
    randomizationConfig: null,
    initialProperties: {},
    conditionProperties: {},
    rollBackTime: 60,
    routines: [],
    ...overrides,
  };
}

function participantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "p-existing",
    experimentId: "exp-1",
    responseId: "resp-alice",
    externalId: "alice",
    condition: null,
    progress: 3,
    currentStage: 0,
    completion: false,
    properties: {},
    progressSequence: null,
    lastLogTime: new Date(),
    ...overrides,
  };
}

/** Register the handler on a socket already scoped to the experiment. */
async function joinWith(payload: { responseId?: string; externalId?: string }) {
  const { registerExperimentHandler } = await import("../socket/experimentHandler.js");
  const { MemoryWaitingRoomStore } = await import("../socket/waitingRoomStore.js");
  const socket = createMockSocket();
  socket.data = { experimentId: "exp-1" };
  registerExperimentHandler(
    createMockNamespace() as never,
    socket as never,
    new MemoryWaitingRoomStore(),
  );
  await socket._trigger("exp:join", payload);
  return socket;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experimentRow() as never);
  vi.mocked(prisma.participant.create).mockResolvedValue(
    participantRow({ id: "p-new", responseId: "resp-new", externalId: "bob" }) as never,
  );
  vi.mocked(prisma.participant.update).mockImplementation(
    (async (args: { where: { id: string } }) =>
      participantRow({ id: args.where.id })) as never,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("exp:join — an external id outranks a stale responseId", () => {
  it("creates a new participant when the external id is unknown", async () => {
    // The browser sends BOTH: the responseId localStorage kept from the last
    // person to use this profile, and the external id from the URL. A second
    // tab opened as ?PID=bob must not become alice.
    vi.mocked(prisma.participant.findFirst).mockImplementation((async (args: {
      where: { externalId?: string; responseId?: string };
    }) => (args.where.responseId === "resp-alice" ? participantRow() : null)) as never);

    const socket = await joinWith({ responseId: "resp-alice", externalId: "bob" });

    expect(prisma.participant.create).toHaveBeenCalledOnce();
    const joined = socket.emit.mock.calls.find((c) => c[0] === "exp:joined");
    expect((joined?.[1] as { participantId: string }).participantId).toBe("p-new");
  });

  it("stores the external id on the participant it creates", async () => {
    vi.mocked(prisma.participant.findFirst).mockResolvedValue(null as never);

    await joinWith({ externalId: "bob" });

    const created = vi.mocked(prisma.participant.create).mock.calls[0][0] as {
      data: { externalId: string | null };
    };
    expect(created.data.externalId).toBe("bob");
  });

  it("still resumes a participant whose external id is known", async () => {
    vi.mocked(prisma.participant.findFirst).mockImplementation((async (args: {
      where: { externalId?: string };
    }) => (args.where.externalId === "alice" ? participantRow() : null)) as never);

    const socket = await joinWith({ responseId: "resp-stale", externalId: "alice" });

    expect(prisma.participant.create).not.toHaveBeenCalled();
    const joined = socket.emit.mock.calls.find((c) => c[0] === "exp:joined");
    expect((joined?.[1] as { participantId: string }).participantId).toBe("p-existing");
  });

  it("still resumes by responseId when no external id is sent", async () => {
    vi.mocked(prisma.participant.findFirst).mockImplementation((async (args: {
      where: { responseId?: string };
    }) => (args.where.responseId === "resp-alice" ? participantRow() : null)) as never);

    const socket = await joinWith({ responseId: "resp-alice" });

    expect(prisma.participant.create).not.toHaveBeenCalled();
    const joined = socket.emit.mock.calls.find((c) => c[0] === "exp:joined");
    expect((joined?.[1] as { participantId: string }).participantId).toBe("p-existing");
  });

  it("falls back to responseId when the experiment names no id parameter", async () => {
    // Without participantIdParam the external id is not in play at all, so the
    // saved responseId remains the only way to resume.
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(
      experimentRow({ participantIdParam: null }) as never,
    );
    vi.mocked(prisma.participant.findFirst).mockImplementation((async (args: {
      where: { responseId?: string };
    }) => (args.where.responseId === "resp-alice" ? participantRow() : null)) as never);

    const socket = await joinWith({ responseId: "resp-alice", externalId: "ignored" });

    expect(prisma.participant.create).not.toHaveBeenCalled();
    const joined = socket.emit.mock.calls.find((c) => c[0] === "exp:joined");
    expect((joined?.[1] as { participantId: string }).participantId).toBe("p-existing");
  });
});
