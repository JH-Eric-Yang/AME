import { describe, it, expect, vi } from "vitest";
import { buildReport } from "../reporter";

vi.mock("$lib/socket/experimentSocket", () => ({
  getSocket: vi.fn(),
}));
vi.mock("$lib/stores/runner", () => ({
  // svelte's `get(store)` calls `subscribe` once, synchronously, and
  // immediately unsubscribes — this is enough to satisfy that contract
  // without pulling in the real (much heavier) runner store.
  runner: {
    subscribe: (fn: (value: { routine?: { name: string }; progress?: number }) => void) => {
      fn({ routine: undefined, progress: undefined });
      return () => {};
    },
  },
}));

describe("buildReport", () => {
  it("carries the routine and progress the participant was on", () => {
    const report = buildReport(new Error("camera busy"), { routine: "pos-check", progress: 2 });

    expect(report).toMatchObject({ name: "Error", message: "camera busy", routine: "pos-check", progress: 2 });
  });

  it("truncates an enormous stack", () => {
    const err = new Error("boom");
    err.stack = "S".repeat(30000);

    expect(buildReport(err, {}).stack).toHaveLength(8 * 1024);
  });

  it("keeps a small context and drops an oversized one", () => {
    expect(buildReport(new Error("x"), {}, { kind: "getUserMedia" }).context).toEqual({ kind: "getUserMedia" });
    // truncateReport (Task 1) deliberately returns {} rather than undefined for
    // an oversized context, so a caller can tell "no context" apart from
    // "context too large" — see task-1-report.md's design decision.
    expect(buildReport(new Error("x"), {}, { blob: "y".repeat(5000) }).context).toEqual({});
  });

  it("describes a non-Error rejection", () => {
    expect(buildReport("just a string", {})).toMatchObject({ name: "Error", message: "just a string" });
  });
});

describe("reportClientError", () => {
  // reportClientError runs inside the `window` `error` listener installed by
  // installErrorReporting: a throw here is itself an uncaught error, which
  // re-enters the same listener — an unbounded loop that would freeze a
  // participant's tab. No current caller can trigger this (every context is
  // string-valued), which is exactly why it must be closed now, before a
  // fifth caller does.
  it("never throws, even when the socket itself throws mid-emit", async () => {
    const { getSocket } = await import("$lib/socket/experimentSocket");
    const { reportClientError } = await import("../reporter");
    vi.mocked(getSocket).mockReturnValue({
      connected: true,
      emit: () => {
        throw new Error("emit exploded");
      },
    } as never);

    expect(() => reportClientError(new Error("boom"))).not.toThrow();
  });
});
