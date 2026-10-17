import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupAdminSocket } from "../socket/adminHandler.js";
import { signToken } from "../middleware/auth.js";
import prisma from "../prisma.js";
import type { WaitingRoomStore } from "../socket/waitingRoomStore.js";

vi.mock("../prisma.js", () => ({
  default: {
    // findUnique: the session loaders resolve each session's block id to its
    // design's label, which reads the experiment's sessionDesigns once per load.
    experiment: { findFirst: vi.fn(), findUnique: vi.fn() },
    session: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}));

const OwnedExperimentId = "exp-owned";
const OtherExperimentId = "exp-someone-elses";
const ExperimenterId = "experimenter-1";

type Middleware = (
  socket: { handshake: { auth?: { token?: string } }; data: Record<string, unknown> },
  next: (err?: Error) => void,
) => void;

type ConnectionHandler = (socket: FakeAdminSocket) => void;

interface FakeAdminSocket {
  id: string;
  data: Record<string, unknown>;
  rooms: Set<string>;
  received: Array<{ event: string; payload: unknown }>;
  on(event: string, handler: (...args: never[]) => unknown): void;
  emit(event: string, payload?: unknown): void;
  join(room: string): Promise<void>;
  leave(room: string): void;
  trigger(event: string, ...args: unknown[]): Promise<void>;
}

const createAdminSocket = (): FakeAdminSocket => {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  return {
    id: "admin-socket-1",
    data: {},
    rooms: new Set<string>(),
    received: [],
    on(event, handler) {
      handlers.set(event, handler);
    },
    emit(event, payload) {
      this.received.push({ event, payload });
    },
    async join(room) {
      this.rooms.add(room);
    },
    leave(room) {
      this.rooms.delete(room);
    },
    async trigger(event, ...args) {
      await handlers.get(event)?.(...(args as never[]));
    },
  };
};

/**
 * Enough of a socket.io Server to capture what setupAdminSocket registers, so
 * the real middleware and the real subscribe handlers can be invoked directly.
 * There is no live websocket here — only the two functions under test.
 */
const createFakeIo = () => {
  let middleware: Middleware | null = null;
  let onConnection: ConnectionHandler | null = null;
  const namespace = {
    use: (fn: Middleware) => {
      middleware = fn;
    },
    on: (event: string, handler: ConnectionHandler) => {
      if (event === "connection") onConnection = handler;
    },
    to: () => ({ emit: vi.fn() }),
    adapter: { rooms: new Map<string, Set<string>>() },
  };
  return {
    io: { of: () => namespace },
    getMiddleware: () => middleware!,
    getOnConnection: () => onConnection!,
  };
};

const emptyStore = {
  getRoomsForExperiment: vi.fn(),
} as unknown as WaitingRoomStore;

/** Run the handshake middleware and report how it answered. */
const handshake = (token: string | undefined) => {
  const { io, getMiddleware } = createFakeIo();
  setupAdminSocket(io as never, emptyStore);
  const socket = {
    handshake: { auth: token ? { token } : undefined },
    data: {} as Record<string, unknown>,
  };
  let error: Error | undefined;
  getMiddleware()(socket, (err) => {
    error = err;
  });
  return { error, socket };
};

/** Connect a socket that has already passed the handshake as this experimenter. */
const connectAs = (experimenterId: string) => {
  const { io, getOnConnection } = createFakeIo();
  setupAdminSocket(io as never, emptyStore);
  const socket = createAdminSocket();
  socket.data.experimenterId = experimenterId;
  getOnConnection()(socket);
  return socket;
};

beforeEach(() => {
  vi.mocked(emptyStore.getRoomsForExperiment).mockResolvedValue([]);
  vi.mocked(prisma.session.findMany).mockResolvedValue([] as never);
  // Ownership is a join through ExperimenterExperiment; only the owned
  // experiment resolves for this experimenter.
  vi.mocked(prisma.experiment.findFirst).mockImplementation((async (args: {
    where: { id: string; experimenters: { some: { experimenterId: string } } };
  }) => {
    const owned =
      args.where.id === OwnedExperimentId &&
      args.where.experimenters.some.experimenterId === ExperimenterId;
    return owned ? { id: OwnedExperimentId } : null;
  }) as never);
});

describe("admin socket handshake", () => {
  it("admits an EXPERIMENTER, which is the role every real researcher account holds", () => {
    // Experimenter.role defaults to EXPERIMENTER and nothing promotes an
    // account, so rejecting this role rejected every real researcher — the
    // dashboard's live queue and session updates reached nobody at all.
    const token = signToken({
      experimenterId: ExperimenterId,
      email: "r@example.com",
      role: "EXPERIMENTER",
    });

    const { error, socket } = handshake(token);

    expect(error).toBeUndefined();
    expect(socket.data.experimenterId).toBe(ExperimenterId);
  });

  it("still admits an ADMIN", () => {
    const token = signToken({
      experimenterId: ExperimenterId,
      email: "a@example.com",
      role: "ADMIN",
    });

    expect(handshake(token).error).toBeUndefined();
  });

  it("rejects a token carrying neither role", () => {
    const token = signToken({
      experimenterId: ExperimenterId,
      email: "x@example.com",
      role: "PARTICIPANT",
    });

    expect(handshake(token).error?.message).toBe("Experimenter access required");
  });

  it("rejects a missing token", () => {
    expect(handshake(undefined).error?.message).toBe("Authentication required");
  });

  it("rejects a token it cannot verify", () => {
    expect(handshake("not-a-real-token").error?.message).toBe("Invalid token");
  });
});

describe("admin subscriptions are gated by ownership, not by role", () => {
  it("refuses session:subscribe for an experiment this experimenter does not own", async () => {
    // The point of widening the handshake: admitting EXPERIMENTER must not
    // widen what anybody can READ. Ownership is the boundary, and the session
    // payload carries participants' recruitment ids.
    const socket = connectAs(ExperimenterId);

    await socket.trigger("session:subscribe", { experimentId: OtherExperimentId });

    expect(socket.rooms.size).toBe(0);
    expect(socket.received).toEqual([]);
    expect(prisma.session.findMany).not.toHaveBeenCalled();
  });

  it("refuses queue:subscribe for an experiment this experimenter does not own", async () => {
    const socket = connectAs(ExperimenterId);

    await socket.trigger("queue:subscribe", { experimentId: OtherExperimentId });

    expect(socket.rooms.size).toBe(0);
    expect(socket.received).toEqual([]);
    expect(emptyStore.getRoomsForExperiment).not.toHaveBeenCalled();
  });

  // Destructuring the payload inside an async listener turns an emit with no
  // payload into a TypeError that socket.io does not catch, so the unhandled
  // rejection takes the whole server down — reachable by any authenticated
  // experimenter, and it drops every live participant's websocket with it.
  it.each([
    ["queue:subscribe"],
    ["queue:unsubscribe"],
    ["session:subscribe"],
    ["session:unsubscribe"],
  ])("ignores a %s carrying no payload at all", async (event) => {
    const socket = connectAs(ExperimenterId);

    await expect(socket.trigger(event)).resolves.toBeUndefined();

    expect(socket.rooms.size).toBe(0);
    expect(socket.received).toEqual([]);
    expect(prisma.experiment.findFirst).not.toHaveBeenCalled();
  });

  it("ignores a subscribe whose payload names no experiment", async () => {
    const socket = connectAs(ExperimenterId);

    await socket.trigger("session:subscribe", { experimentId: "" });

    expect(socket.rooms.size).toBe(0);
    expect(prisma.experiment.findFirst).not.toHaveBeenCalled();
  });

  it("serves an experiment this experimenter does own", async () => {
    const socket = connectAs(ExperimenterId);

    await socket.trigger("session:subscribe", { experimentId: OwnedExperimentId });

    expect(socket.rooms.has(`admin:${OwnedExperimentId}:sessions`)).toBe(true);
    expect(socket.received.map((r) => r.event)).toEqual(["session:state"]);
  });
});
