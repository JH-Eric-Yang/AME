/**
 * chatHandler — the text channel (spec §6.1). A message goes to the members of
 * the sender's current interaction group on the current step, and nowhere
 * else; the scope is set by deliverContent on every delivery, so a rotation
 * moves a participant to a new thread without the client asking.
 */

import type { Namespace } from "socket.io";
import type { ChatLine, ClientToServerEvents, ServerToClientEvents } from "ame-shared";
import type { TypedSocket, SocketState } from "./index.js";
import type { ChatStore } from "./chatStore.js";
import { participantRoom } from "./rooms.js";
import { safeOn } from "./safeListener.js";

type TypedNamespace = Namespace<ClientToServerEvents, ServerToClientEvents>;

export const MaxChatMessageLength = 2000;
/** Thread lifetime when the experiment has no active time set. */
export const DefaultChatTtlMinutes = 1440;
const SecondsPerMinute = 60;

export interface ChatScope {
  /** Redis key of the thread. */
  key: string;
  /** `<progress>:<groupIndex>`, echoed to clients so a late message from a previous step is ignored. */
  scope: string;
  /** The group's members, sender included — the sender's copy is their confirmation. */
  memberIds: string[];
  seat: number;
  ttlSeconds: number;
}

export function chatTtlSeconds(activeTimeMinutes: number | null | undefined): number {
  const minutes = activeTimeMinutes && activeTimeMinutes > 0 ? activeTimeMinutes : DefaultChatTtlMinutes;
  return minutes * SecondsPerMinute;
}

export function registerChatHandler(ns: TypedNamespace, socket: TypedSocket, store: ChatStore): void {
  // socket.io never awaits a listener, so both handlers catch their own failures:
  // an unhandled rejection would take down the process and every participant's socket.
  safeOn(socket, "chat:send", async (payload) => {
    const state = socket.data as SocketState;
    const scope = state.chat;
    if (!state.participantId || !state.experimentId || !scope) {
      // Dropped quietly: the client disables its composer when history names no
      // thread, so this is a race or a stale tab, and every `error` becomes a
      // permanent banner on the participant's screen.
      console.warn(`[chat:send] Dropped a message from socket ${socket.id}: no text chat on this step`);
      return;
    }

    const text = typeof payload?.text === "string" ? payload.text.trim() : "";
    if (!text) return;
    if (text.length > MaxChatMessageLength) {
      socket.emit("error", { code: "CHAT_TOO_LONG", message: `Messages are limited to ${MaxChatMessageLength} characters` });
      return;
    }

    const line: ChatLine = { from: state.participantId, seat: scope.seat, text, at: Date.now() };
    try {
      await store.append(scope.key, line, scope.ttlSeconds);
    } catch (err) {
      console.error("[chat:send] Failed to store message:", err);
      socket.emit("error", { code: "INTERNAL", message: "Failed to send message" });
      return;
    }

    for (const participantId of scope.memberIds) {
      ns.to(participantRoom(state.experimentId, participantId)).emit("chat:message", { scope: scope.scope, line });
    }
  });

  safeOn(socket, "chat:history", async () => {
    const scope = (socket.data as SocketState).chat;
    if (!scope) {
      socket.emit("chat:history", { scope: "", lines: [] });
      return;
    }
    try {
      socket.emit("chat:history", { scope: scope.scope, lines: await store.history(scope.key) });
    } catch (err) {
      console.error("[chat:history] Failed to read thread:", err);
      socket.emit("chat:history", { scope: scope.scope, lines: [] });
    }
  });
}
