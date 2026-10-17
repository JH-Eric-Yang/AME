/**
 * chatThread — the text channel of the step on screen (spec §6.1). The server
 * scopes a thread to (session, progress, group); the client learns the scope
 * from the `chat:history` answer rather than computing it, so the two cannot
 * disagree about which progress a step is.
 *
 * No media lifecycle: CallSessionHost opens it for a routine with a text tile
 * and closes it otherwise.
 */

import { get, writable, type Readable } from "svelte/store";
import type { ChatLine } from "ame-shared";
import { emitChatHistory, emitChatSend } from "$lib/socket/experimentSocket";
import { mergeLines } from "./threadLines";

export interface ChatThreadState {
  open: boolean;
  /** Null while the history answer is outstanding. */
  scope: string | null;
  lines: ChatLine[];
}

export interface ChatTransport {
  requestHistory(): void;
  send(text: string): void;
}

export interface ChatThread extends Readable<ChatThreadState> {
  /** Opens the thread for the step at `progress`; answers for any other step are ignored. */
  open(progress: number): void;
  close(): void;
  receiveHistory(payload: { scope: string; lines: ChatLine[] }): void;
  receiveMessage(payload: { scope: string; line: ChatLine }): void;
  send(text: string): void;
}

const Closed: ChatThreadState = { open: false, scope: null, lines: [] };
/** A scope is `<progress>:<groupIndex>` (chatScope in ame-shared/videoChat). */
const ScopeSeparator = ":";

/**
 * Whether a scope belongs to the step at `progress`. The empty scope is the
 * server saying this step has no thread, which is an answer for any step.
 */
function scopeBelongsTo(scope: string, progress: number | null): boolean {
  if (scope === "") return true;
  return progress !== null && scope.split(ScopeSeparator)[0] === String(progress);
}

export function createChatThread(transport: ChatTransport): ChatThread {
  const store = writable<ChatThreadState>({ ...Closed });
  /** Live messages that arrived before the history answer named the scope. */
  let early: Array<{ scope: string; line: ChatLine }> = [];
  /**
   * The step the thread was opened for. A history reply carries no request id,
   * so after a fast close and reopen this is what rejects the previous step's answer.
   */
  let progress: number | null = null;

  return {
    subscribe: store.subscribe,
    open(openedFor) {
      early = [];
      progress = openedFor;
      store.set({ open: true, scope: null, lines: [] });
      transport.requestHistory();
    },
    close() {
      early = [];
      progress = null;
      store.set({ ...Closed });
    },
    receiveHistory({ scope, lines }) {
      const state = get(store);
      if (!state.open || !scopeBelongsTo(scope, progress)) return;
      if (state.scope !== null && state.scope !== scope) return;
      const held = early.filter((entry) => entry.scope === scope).map((entry) => entry.line);
      early = [];
      store.set({ open: true, scope, lines: mergeLines(mergeLines(state.lines, lines), held) });
    },
    receiveMessage({ scope, line }) {
      const state = get(store);
      if (!state.open) return;
      if (state.scope === null) {
        if (scopeBelongsTo(scope, progress)) early.push({ scope, line });
        return;
      }
      if (state.scope !== scope) return;
      store.set({ ...state, lines: mergeLines(state.lines, [line]) });
    },
    send(text) {
      const trimmed = text.trim();
      if (trimmed) transport.send(trimmed);
    },
  };
}

export const chatThread = createChatThread({
  requestHistory: () => emitChatHistory(),
  send: (text) => emitChatSend(text),
});
