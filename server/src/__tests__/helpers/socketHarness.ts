/**
 * A multi-socket Socket.IO stand-in with room-aware namespace routing.
 * Unlike the single-socket helper inlined in socket.test.ts, several handler
 * modules may register for the same event: `trigger` awaits all of them, which
 * matters because experimentHandler and matchingHandler both listen on
 * "disconnect" and only one of them drops the seat.
 */

type Handler = (...args: never[]) => unknown;

export interface RecordedEmit {
  event: string;
  payload: unknown;
}

export interface Emitter {
  emit(event: string, payload?: unknown): void;
}

export interface FakeSocket {
  id: string;
  data: Record<string, unknown>;
  rooms: Set<string>;
  connected: boolean;
  received: RecordedEmit[];
  on(event: string, handler: Handler): void;
  emit(event: string, payload?: unknown): void;
  join(room: string): void;
  leave(room: string): void;
  to(room: string): Emitter;
  /** Socket.IO's own signature: synchronous, and it does NOT run the handlers. */
  disconnect(): void;
  trigger(event: string, ...args: unknown[]): Promise<void>;
}

export interface FakeNamespace {
  sockets: FakeSocket[];
  connect(id: string): FakeSocket;
  to(target: string): Emitter;
  fetchSockets(): Promise<FakeSocket[]>;
}

/** A socket is addressable by its own id or by any room it has joined. */
const isAddressed = (socket: FakeSocket, target: string): boolean =>
  socket.id === target || socket.rooms.has(target);

export function createFakeNamespace(): FakeNamespace {
  const sockets: FakeSocket[] = [];

  const deliver = (
    target: string,
    event: string,
    payload: unknown,
    exclude?: FakeSocket,
  ): void => {
    for (const socket of sockets) {
      if (socket === exclude || !socket.connected) continue;
      if (isAddressed(socket, target)) socket.received.push({ event, payload });
    }
  };

  const connect = (id: string): FakeSocket => {
    const handlers = new Map<string, Handler[]>();
    const socket: FakeSocket = {
      id,
      data: {},
      rooms: new Set<string>(),
      connected: true,
      received: [],
      on(event, handler) {
        const existing = handlers.get(event) ?? [];
        existing.push(handler);
        handlers.set(event, existing);
      },
      emit(event, payload) {
        socket.received.push({ event, payload });
      },
      join(room) {
        socket.rooms.add(room);
      },
      leave(room) {
        socket.rooms.delete(room);
      },
      to(room) {
        return {
          emit(event, payload) {
            deliver(room, event, payload, socket);
          },
        };
      },
      disconnect() {
        socket.connected = false;
        socket.rooms.clear();
      },
      async trigger(event, ...args) {
        for (const handler of handlers.get(event) ?? []) {
          await handler(...(args as never[]));
        }
      },
    };
    sockets.push(socket);
    return socket;
  };

  return {
    sockets,
    connect,
    to(target) {
      return {
        emit(event, payload) {
          deliver(target, event, payload);
        },
      };
    },
    /** Mirrors socket.io: a disconnected socket is no longer in the namespace. */
    async fetchSockets() {
      return sockets.filter((socket) => socket.connected);
    },
  };
}
