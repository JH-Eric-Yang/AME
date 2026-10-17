/**
 * Socket.IO never awaits a listener, so a rejected async listener escapes as an
 * unhandled rejection. Before `installProcessErrorHandlers` that ended the
 * process and every participant's socket with it; even now it is an error
 * nobody sees and a participant left waiting. Every listener goes through here:
 * the failure is recorded, the one socket that caused it is told, and no other
 * participant is affected (spec §2.1).
 */

import type { Socket } from "socket.io";
import type { ClientToServerEvents } from "ame-shared";
import { reportError } from "../errors/reportError.js";
import type { TypedSocket, SocketState } from "./index.js";

/** Deliberately vague: a participant must never read an internal failure. */
const FailureMessage = "Something went wrong. Your session is still running.";

function handleFailure(socket: TypedSocket | Socket, event: string, err: unknown, notify: boolean): void {
  const state = (socket.data ?? {}) as SocketState;
  reportError(err, {
    source: "SERVER_SOCKET",
    experimentId: state.experimentId ?? null,
    participantId: state.participantId ?? null,
    responseId: state.responseId ?? null,
    progress: state.progress ?? null,
    context: { event, socketId: socket.id },
  });
  if (notify) (socket as TypedSocket).emit("error", { code: "INTERNAL", message: FailureMessage });
}

/**
 * Runs the handler and never lets it throw or reject past this point. The
 * settled (never-rejecting) promise is returned rather than discarded: a real
 * Socket.IO ignores a listener's return value, but the fake sockets used in
 * tests await it directly to know when the handler's async work is done —
 * discarding it here would let a caller's `await trigger(...)` resolve one
 * microtask early, before the handler's own awaits (e.g. a Prisma call) settle.
 */
function guard(socket: TypedSocket | Socket, event: string, run: () => unknown, notify: boolean): void | Promise<void> {
  try {
    const result = run();
    if (result instanceof Promise) {
      return result.catch((err) => handleFailure(socket, event, err, notify));
    }
  } catch (err) {
    handleFailure(socket, event, err, notify);
  }
}

/** Register a listener for a typed client event. */
export function safeOn<E extends keyof ClientToServerEvents>(
  socket: TypedSocket,
  event: E,
  handler: (...args: Parameters<ClientToServerEvents[E]>) => void | Promise<void>,
): void {
  const listener = (...args: Parameters<ClientToServerEvents[E]>): void | Promise<void> => {
    return guard(socket, event as string, () => handler(...args), true);
  };
  (socket.on as any)(event, listener);
}

/**
 * `disconnect` is a reserved event, and the socket is already gone — a failure
 * is recorded but never emitted back.
 */
export function safeOnDisconnect(
  socket: TypedSocket,
  handler: (reason: string) => void | Promise<void>,
): void {
  socket.on("disconnect", (reason: string) => {
    return guard(socket, "disconnect", () => handler(reason), false);
  });
}

/**
 * The admin namespace's socket is not typed by `ClientToServerEvents`, so the
 * payload type comes from the handler — `safeOnAdmin(socket, "queue:subscribe",
 * async (payload?: { experimentId?: string }) => …)` keeps its destructuring.
 * An admin dashboard is told nothing on failure; it polls anyway.
 */
export function safeOnAdmin<P>(
  socket: Socket,
  event: string,
  handler: (payload?: P) => void | Promise<void>,
): void {
  socket.on(event, (payload?: P) => {
    return guard(socket, event, () => handler(payload), false);
  });
}
