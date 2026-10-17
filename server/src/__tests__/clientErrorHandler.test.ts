import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFakeNamespace, type FakeSocket } from "./helpers/socketHarness.js";
import { registerClientErrorHandler, MaxClientReportsPerWindow, ClientReportWindowMs } from "../socket/clientErrorHandler.js";
import { FixedWindowRateLimiter } from "../middleware/rateLimit.js";
import { setErrorSink, consoleSink, type ErrorRecord } from "../errors/reportError.js";
import type { TypedSocket } from "../socket/index.js";

const asTyped = (socket: FakeSocket): TypedSocket => socket as unknown as TypedSocket;
let records: ErrorRecord[];

beforeEach(() => {
  records = [];
  setErrorSink((r) => records.push(r));
});

afterEach(() => {
  setErrorSink(consoleSink);
  vi.restoreAllMocks();
});

function connected(): FakeSocket {
  const socket = createFakeNamespace().connect("s1");
  socket.data = { experimentId: "exp-1", participantId: "p-1", responseId: "r-1" };
  return socket;
}

describe("client:error", () => {
  // Pins the literal cap values: importing and asserting against the exported
  // constants alone cannot catch a drift (e.g. 20 quietly becoming 5), because
  // every other test imports the same constants and would silently follow them.
  it("caps the window at the documented values", () => {
    expect([MaxClientReportsPerWindow, ClientReportWindowMs]).toEqual([20, 60_000]);
  });

  it("records a browser report against the socket's own participant", async () => {
    const socket = connected();
    registerClientErrorHandler(asTyped(socket));

    await socket.trigger("client:error", {
      name: "NotAllowedError",
      message: "Permission denied",
      routine: "pos-check",
      progress: 1,
      context: { kind: "getUserMedia" },
    });

    expect(records).toHaveLength(1);
    // `reportError` takes a thrown value (decision #5 of the task brief): the
    // group's top-level `name` is therefore the synthetic Error's own name,
    // "Error", while the browser's real class survives in `context.name`.
    expect(records[0]).toMatchObject({
      source: "CLIENT",
      name: "Error",
      message: "Permission denied",
      experimentId: "exp-1",
      participantId: "p-1",
      responseId: "r-1",
      routine: "pos-check",
      progress: 1,
    });
    expect(records[0].context).toMatchObject({ name: "NotAllowedError" });
  });

  it("stores the browser's own stack, not a server-side frame through this handler", async () => {
    const socket = connected();
    registerClientErrorHandler(asTyped(socket));
    const browserStack = "NotAllowedError: Permission denied\n    at getUserMedia (app.js:42:7)";

    await socket.trigger("client:error", {
      name: "NotAllowedError",
      message: "Permission denied",
      stack: browserStack,
    });

    expect(records[0].stack).toBe(browserStack);
    expect(records[0].stack).not.toContain("clientErrorHandler");
    // No longer duplicated into context now that the real stack is on the error.
    expect(records[0].context).not.toHaveProperty("stack");
  });

  it("falls back to a stack through this handler when the browser sent none", async () => {
    const socket = connected();
    registerClientErrorHandler(asTyped(socket));

    await socket.trigger("client:error", { name: "Error", message: "x" });

    expect(records[0].stack).toContain("clientErrorHandler");
  });

  it("ignores experiment and participant ids sent by the client", async () => {
    const socket = connected();
    registerClientErrorHandler(asTyped(socket));

    await socket.trigger("client:error", { name: "Error", message: "x", experimentId: "someone-else", participantId: "victim" });

    expect(records[0]).toMatchObject({ experimentId: "exp-1", participantId: "p-1" });
  });

  it("truncates an oversized report", async () => {
    const socket = connected();
    registerClientErrorHandler(asTyped(socket));

    await socket.trigger("client:error", { name: "Error", message: "M".repeat(9000) });

    expect(records[0].message).toHaveLength(500);
  });

  it("drops reports past the per-socket limit", async () => {
    const socket = connected();
    registerClientErrorHandler(asTyped(socket), new FixedWindowRateLimiter(MaxClientReportsPerWindow, ClientReportWindowMs));

    for (let i = 0; i < MaxClientReportsPerWindow + 5; i += 1) {
      await socket.trigger("client:error", { name: "Error", message: `boom ${i}` });
    }

    expect(records).toHaveLength(MaxClientReportsPerWindow);
  });

  it("never answers the participant — reporting is silent", async () => {
    const socket = connected();
    registerClientErrorHandler(asTyped(socket));

    await socket.trigger("client:error", { name: "Error", message: "x" });

    expect(socket.received).toEqual([]);
  });

  it("drops a report from a socket that has not joined", async () => {
    const socket = createFakeNamespace().connect("s2");
    socket.data = {};
    registerClientErrorHandler(asTyped(socket));

    await socket.trigger("client:error", { name: "Error", message: "x" });

    expect(records).toEqual([]);
  });
});
