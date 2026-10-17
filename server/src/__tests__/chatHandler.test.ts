import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryChatStore } from "../socket/chatStore.js";
import { registerChatHandler, chatTtlSeconds, MaxChatMessageLength, DefaultChatTtlMinutes } from "../socket/chatHandler.js";

function createMockSocket() {
  const handlers = new Map<string, Function>();
  return {
    id: "s1",
    data: {} as Record<string, unknown>,
    on: vi.fn((e: string, h: Function) => { handlers.set(e, h); }),
    emit: vi.fn(),
    trigger: (e: string, ...a: unknown[]) => handlers.get(e)?.(...a),
  };
}

function createMockNamespace(roomEmits: Array<{ room: string; event: string; payload: unknown }>) {
  return {
    to: vi.fn((room: string) => ({
      emit: (event: string, payload: unknown) => { roomEmits.push({ room, event, payload }); },
    })),
  };
}

const Scope = { key: "ame:chat:sess-1:4:1", scope: "4:1", memberIds: ["p1", "p2"], seat: 0, ttlSeconds: 1800 };

describe("chat handler", () => {
  let socket: ReturnType<typeof createMockSocket>;
  let roomEmits: Array<{ room: string; event: string; payload: unknown }>;
  let store: MemoryChatStore;

  beforeEach(() => {
    socket = createMockSocket();
    roomEmits = [];
    store = new MemoryChatStore();
    registerChatHandler(createMockNamespace(roomEmits) as never, socket as never, store);
  });

  it("drops a message without an error when this step has no chat", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    socket.data = { experimentId: "exp-1", participantId: "p1" };
    await socket.trigger("chat:send", { text: "hi" });
    expect(socket.emit).not.toHaveBeenCalled();
    expect(roomEmits).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("stamps, stores and fans a message out to every group member's room", async () => {
    socket.data = { experimentId: "exp-1", participantId: "p1", chat: Scope };
    vi.spyOn(Date, "now").mockReturnValue(1234);
    await socket.trigger("chat:send", { text: "  hello  " });
    const line = { from: "p1", seat: 0, text: "hello", at: 1234 };
    expect(roomEmits).toEqual([
      { room: "experiment:exp-1:p1", event: "chat:message", payload: { scope: "4:1", line } },
      { room: "experiment:exp-1:p2", event: "chat:message", payload: { scope: "4:1", line } },
    ]);
    expect(await store.history(Scope.key)).toEqual([line]);
    vi.restoreAllMocks();
  });

  it("ignores a blank message and refuses an over-long one", async () => {
    socket.data = { experimentId: "exp-1", participantId: "p1", chat: Scope };
    await socket.trigger("chat:send", { text: "   " });
    await socket.trigger("chat:send", { text: "x".repeat(MaxChatMessageLength + 1) });
    expect(roomEmits).toEqual([]);
    expect(socket.emit).toHaveBeenCalledWith("error", {
      code: "CHAT_TOO_LONG", message: `Messages are limited to ${MaxChatMessageLength} characters`,
    });
  });

  it("answers history for the current scope, and an empty scope when there is none", async () => {
    socket.data = { experimentId: "exp-1", participantId: "p1", chat: Scope };
    await store.append(Scope.key, { from: "p2", seat: 1, text: "earlier", at: 1 }, 60);
    await socket.trigger("chat:history");
    expect(socket.emit).toHaveBeenCalledWith("chat:history", { scope: "4:1", lines: [{ from: "p2", seat: 1, text: "earlier", at: 1 }] });

    socket.data = { experimentId: "exp-1", participantId: "p1" };
    await socket.trigger("chat:history");
    expect(socket.emit).toHaveBeenCalledWith("chat:history", { scope: "", lines: [] });
  });
});

describe("chatTtlSeconds", () => {
  it("uses the experiment's active time and falls back when it is not set", () => {
    expect(chatTtlSeconds(30)).toBe(1800);
    expect(chatTtlSeconds(0)).toBe(DefaultChatTtlMinutes * 60);
    expect(chatTtlSeconds(undefined)).toBe(DefaultChatTtlMinutes * 60);
  });
});
