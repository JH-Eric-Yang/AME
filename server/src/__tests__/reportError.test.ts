import { describe, it, expect, vi, afterEach } from "vitest";
import { reportError, setErrorSink, consoleSink, type ErrorRecord } from "../errors/reportError.js";

function collecting(): { records: ErrorRecord[]; sink: (r: ErrorRecord) => void } {
  const records: ErrorRecord[] = [];
  return { records, sink: (r) => records.push(r) };
}

describe("reportError", () => {
  afterEach(() => {
    setErrorSink(consoleSink);
    vi.restoreAllMocks();
  });

  it("normalises the error and the context into one record", () => {
    const { records, sink } = collecting();
    setErrorSink(sink);

    reportError(new Error("Participant 9f1 not found"), {
      source: "SERVER_SOCKET",
      experimentId: "exp-1",
      participantId: "p-1",
      routine: "consent",
      progress: 2,
      context: { event: "exp:ready" },
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      source: "SERVER_SOCKET",
      name: "Error",
      message: "Participant 9f1 not found",
      experimentId: "exp-1",
      participantId: "p-1",
      routine: "consent",
      progress: 2,
      context: { event: "exp:ready" },
    });
    expect(records[0].occurredAt).toBeInstanceOf(Date);
  });

  it("defaults every absent context field to null", () => {
    const { records, sink } = collecting();
    setErrorSink(sink);

    reportError("boom", { source: "SERVER_TASK" });

    expect(records[0]).toMatchObject({
      experimentId: null,
      participantId: null,
      responseId: null,
      routine: null,
      progress: null,
    });
  });

  it("redacts a signed token in a context url", () => {
    const { records, sink } = collecting();
    setErrorSink(sink);

    reportError(new Error("fetch failed"), {
      source: "SERVER_HTTP",
      context: { url: "/api/uploads/abc?token=eyJ.secret" },
    });

    expect(records[0].context).toMatchObject({ url: "/api/uploads/abc?token=REDACTED" });
  });

  it("never throws when the sink throws, and logs instead", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    setErrorSink(() => {
      throw new Error("sink is broken");
    });

    expect(() => reportError(new Error("original"), { source: "SERVER_TASK" })).not.toThrow();
    expect(log).toHaveBeenCalled();
  });

  it("does not re-enter itself when the sink throws", () => {
    let calls = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    setErrorSink(() => {
      calls += 1;
      throw new Error("sink is broken");
    });

    reportError(new Error("original"), { source: "SERVER_TASK" });

    expect(calls).toBe(1);
  });
});
