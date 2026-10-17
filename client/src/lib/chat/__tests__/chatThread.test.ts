import { describe, it, expect, vi } from "vitest";
import { get } from "svelte/store";
import { createChatThread } from "../chatThread";

const line = (from: string, at: number, text = "m") => ({ from, seat: 0, text, at });

function setup() {
  const transport = { requestHistory: vi.fn(), send: vi.fn() };
  return { thread: createChatThread(transport), transport };
}

describe("chatThread", () => {
  it("opening clears the thread and asks for history", () => {
    const { thread, transport } = setup();
    thread.open(4);
    expect(get(thread)).toEqual({ open: true, scope: null, lines: [] });
    expect(transport.requestHistory).toHaveBeenCalledTimes(1);
  });

  it("history names the scope and fills the thread", () => {
    const { thread } = setup();
    thread.open(4);
    thread.receiveHistory({ scope: "4:1", lines: [line("p2", 1)] });
    expect(get(thread)).toEqual({ open: true, scope: "4:1", lines: [line("p2", 1)] });
  });

  it("holds messages that beat the history and merges those in its scope", () => {
    const { thread } = setup();
    thread.open(4);
    thread.receiveMessage({ scope: "4:1", line: line("p2", 3) });
    thread.receiveMessage({ scope: "3:0", line: line("p9", 2) });
    thread.receiveHistory({ scope: "4:1", lines: [line("p2", 1), line("p2", 3)] });
    expect(get(thread).lines).toEqual([line("p2", 1), line("p2", 3)]);
  });

  it("appends live messages in scope and ignores a late one from a previous step", () => {
    const { thread } = setup();
    thread.open(4);
    thread.receiveHistory({ scope: "4:1", lines: [] });
    thread.receiveMessage({ scope: "4:1", line: line("p1", 5) });
    thread.receiveMessage({ scope: "3:0", line: line("p1", 6) });
    expect(get(thread).lines).toEqual([line("p1", 5)]);
  });

  it("rejects a history reply for a previous step after a fast close and reopen", () => {
    const { thread, transport } = setup();
    thread.open(3);
    thread.close();
    thread.open(4);
    thread.receiveMessage({ scope: "3:0", line: line("p9", 1) });
    thread.receiveHistory({ scope: "3:0", lines: [line("p9", 1)] });
    expect(get(thread)).toEqual({ open: true, scope: null, lines: [] });
    thread.receiveHistory({ scope: "4:1", lines: [line("p2", 2)] });
    expect(get(thread)).toEqual({ open: true, scope: "4:1", lines: [line("p2", 2)] });
    expect(transport.requestHistory).toHaveBeenCalledTimes(2);
  });

  it("does not confuse progress 1 with a scope for progress 14", () => {
    const { thread } = setup();
    thread.open(1);
    thread.receiveHistory({ scope: "14:1", lines: [line("p2", 2)] });
    expect(get(thread).scope).toBeNull();
  });

  it("accepts the empty scope, which means this step has no thread", () => {
    const { thread } = setup();
    thread.open(4);
    thread.receiveHistory({ scope: "", lines: [] });
    expect(get(thread)).toEqual({ open: true, scope: "", lines: [] });
  });

  it("ignores everything while closed", () => {
    const { thread } = setup();
    thread.receiveMessage({ scope: "4:1", line: line("p1", 5) });
    thread.receiveHistory({ scope: "4:1", lines: [line("p1", 5)] });
    expect(get(thread)).toEqual({ open: false, scope: null, lines: [] });
  });

  it("closing forgets the thread", () => {
    const { thread } = setup();
    thread.open(4);
    thread.receiveHistory({ scope: "4:1", lines: [line("p1", 5)] });
    thread.close();
    expect(get(thread)).toEqual({ open: false, scope: null, lines: [] });
  });

  it("sends trimmed text and drops a blank message", () => {
    const { thread, transport } = setup();
    thread.send("  hi  ");
    thread.send("   ");
    expect(transport.send.mock.calls).toEqual([["hi"]]);
  });
});
