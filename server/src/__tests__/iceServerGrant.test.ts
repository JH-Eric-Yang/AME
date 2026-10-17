import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import prisma from "../prisma.js";

vi.mock("../prisma.js", () => ({
  default: {
    experiment: { findUnique: vi.fn(), update: vi.fn() },
    participant: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

/**
 * Only a socket that joined as a participant gets a TURN password, so a
 * stranger cannot use the relay. The join itself is covered in
 * externalIdJoin.test.ts; this covers who receives `ice:servers`.
 */

function createMockSocket() {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  return {
    id: "socket-1",
    data: { experimentId: "exp-1" } as Record<string, unknown>,
    on: vi.fn((event: string, handler: (...args: never[]) => unknown) => {
      handlers.set(event, handler);
    }),
    emit: vi.fn(),
    join: vi.fn(),
    to: vi.fn(() => ({ emit: vi.fn() })),
    disconnect: vi.fn(),
    _trigger: (event: string, ...args: unknown[]) => handlers.get(event)?.(...(args as never[])),
  };
}

const experimentRow = (overrides: Record<string, unknown> = {}) => ({
  id: "exp-1",
  allowNew: true,
  participantIdParam: null,
  conditions: [],
  currentCondition: null,
  randomization: false,
  randomizationConfig: null,
  initialProperties: {},
  conditionProperties: {},
  rollBackTime: 60,
  routines: [],
  ...overrides,
});

const participantRow = (overrides: Record<string, unknown> = {}) => ({
  id: "p-1",
  experimentId: "exp-1",
  responseId: "resp-1",
  externalId: null,
  condition: null,
  progress: 0,
  currentStage: 0,
  completion: false,
  properties: {},
  progressSequence: null,
  lastLogTime: new Date(),
  ...overrides,
});

async function socketWithHandlers() {
  const { registerExperimentHandler } = await import("../socket/experimentHandler.js");
  const { registerIceRefresh } = await import("../socket/iceServerGrant.js");
  const { MemoryWaitingRoomStore } = await import("../socket/waitingRoomStore.js");
  const socket = createMockSocket();
  const ns = { to: vi.fn(() => ({ emit: vi.fn() })), fetchSockets: vi.fn(async () => []) };
  registerExperimentHandler(ns as never, socket as never, new MemoryWaitingRoomStore());
  registerIceRefresh(socket as never);
  return socket;
}

const iceEmits = (socket: ReturnType<typeof createMockSocket>) =>
  socket.emit.mock.calls.filter((c) => c[0] === "ice:servers").map((c) => c[1] as { iceServers: Array<{ username?: string }> });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TURN_URLS", "turn:turn.example.com:3478");
  vi.stubEnv("TURN_SECRET", "test-secret");
  vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experimentRow() as never);
  vi.mocked(prisma.participant.findFirst).mockResolvedValue(null as never);
  vi.mocked(prisma.participant.create).mockResolvedValue(participantRow() as never);
  vi.mocked(prisma.participant.update).mockResolvedValue(participantRow() as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("ice:servers", () => {
  it("is never sent to a socket that has not joined", async () => {
    const socket = await socketWithHandlers();
    await socket._trigger("ice:refresh");
    expect(iceEmits(socket)).toEqual([]);
  });

  it("is sent with a TURN password after a participant joins, and again on ice:refresh", async () => {
    const socket = await socketWithHandlers();
    await socket._trigger("exp:join", {});

    const events = socket.emit.mock.calls.map((c) => c[0]);
    expect(events.indexOf("ice:servers")).toBeGreaterThan(events.indexOf("exp:joined"));
    expect(iceEmits(socket)[0].iceServers.at(-1)?.username).toMatch(/^\d+:ame$/);

    await socket._trigger("ice:refresh");
    expect(iceEmits(socket)).toHaveLength(2);
  });

  it("is not sent when the join is refused", async () => {
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(experimentRow({ allowNew: false }) as never);
    const socket = await socketWithHandlers();
    await socket._trigger("exp:join", {});
    await socket._trigger("ice:refresh");
    expect(iceEmits(socket)).toEqual([]);
  });

  it("is not sent to a participant who already completed", async () => {
    vi.mocked(prisma.participant.findFirst).mockResolvedValue(participantRow({ completion: true }) as never);
    const socket = await socketWithHandlers();
    await socket._trigger("exp:join", { responseId: "resp-1" });
    await socket._trigger("ice:refresh");
    expect(socket.emit.mock.calls.map((c) => c[0])).toContain("exp:joined");
    expect(iceEmits(socket)).toEqual([]);
  });
});

describe("ice:servers for a paired phone", () => {
  async function connectDevice(participantId: string) {
    const { registerSignalingHandler } = await import("../socket/signalingHandler.js");
    const { registerIceRefresh } = await import("../socket/iceServerGrant.js");
    const socket = createMockSocket();
    socket.data = {};
    const ns = { to: vi.fn(() => ({ emit: vi.fn() })), fetchSockets: vi.fn(async () => []) };
    registerSignalingHandler(ns as never, socket as never);
    registerIceRefresh(socket as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await socket._trigger("device:connect", { participantId, mode: "camera" });
    await socket._trigger("ice:refresh");
    return socket;
  }

  it("is sent when the phone names a real participant", async () => {
    vi.mocked(prisma.participant.findUnique).mockResolvedValue({ experimentId: "exp-1" } as never);
    expect(iceEmits(await connectDevice("p-1"))).toHaveLength(2);
  });

  it("is not sent when the participant does not exist", async () => {
    vi.mocked(prisma.participant.findUnique).mockResolvedValue(null as never);
    expect(iceEmits(await connectDevice("made-up"))).toEqual([]);
  });
});
