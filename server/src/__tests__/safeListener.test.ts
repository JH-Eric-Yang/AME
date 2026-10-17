import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFakeNamespace, type FakeSocket } from "./helpers/socketHarness.js";
import { safeOn, safeOnDisconnect } from "../socket/safeListener.js";
import { setErrorSink, consoleSink, type ErrorRecord } from "../errors/reportError.js";
import type { TypedSocket } from "../socket/index.js";
import { registerDeviceSlotHandler, deviceSlotManager } from "../socket/deviceSlotHandler.js";

const asTyped = (socket: FakeSocket): TypedSocket => socket as unknown as TypedSocket;

let records: ErrorRecord[];

beforeEach(() => {
  records = [];
  setErrorSink((r) => records.push(r));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  setErrorSink(consoleSink);
  vi.restoreAllMocks();
});

describe("safeOn", () => {
  it("reports a rejected listener and tells that socket only", async () => {
    const ns = createFakeNamespace();
    const socket = ns.connect("s1");
    socket.data = { experimentId: "exp-1", participantId: "p-1", progress: 3 };

    safeOn(asTyped(socket), "exp:ready", async () => {
      throw new Error("Can't reach database server");
    });
    await socket.trigger("exp:ready");

    expect(socket.received).toEqual([
      { event: "error", payload: { code: "INTERNAL", message: "Something went wrong. Your session is still running." } },
    ]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      source: "SERVER_SOCKET",
      message: "Can't reach database server",
      experimentId: "exp-1",
      participantId: "p-1",
      progress: 3,
      context: { event: "exp:ready" },
    });
  });

  it("catches a synchronous throw too", async () => {
    const ns = createFakeNamespace();
    const socket = ns.connect("s1");

    safeOn(asTyped(socket), "exp:ready", () => {
      throw new Error("sync boom");
    });
    await socket.trigger("exp:ready");

    expect(records).toHaveLength(1);
  });

  it("leaves another participant's listener working", async () => {
    const ns = createFakeNamespace();
    const failing = ns.connect("s1");
    const healthy = ns.connect("s2");
    let healthyRan = false;

    safeOn(asTyped(failing), "exp:ready", async () => {
      throw new Error("boom");
    });
    safeOn(asTyped(healthy), "exp:ready", async () => {
      healthyRan = true;
    });

    await failing.trigger("exp:ready");
    await healthy.trigger("exp:ready");

    expect(healthyRan).toBe(true);
    expect(healthy.received).toEqual([]);
  });

  it("passes the payload through and stays quiet when the listener succeeds", async () => {
    const ns = createFakeNamespace();
    const socket = ns.connect("s1");
    const seen: unknown[] = [];

    safeOn(asTyped(socket), "match:join", async (payload) => {
      seen.push(payload);
    });
    await socket.trigger("match:join", { routineName: "chat" });

    expect(seen).toEqual([{ routineName: "chat" }]);
    expect(records).toEqual([]);
    expect(socket.received).toEqual([]);
  });
});

describe("safeOnDisconnect", () => {
  it("reports but does not emit, because the socket has gone", async () => {
    const ns = createFakeNamespace();
    const socket = ns.connect("s1");

    safeOnDisconnect(asTyped(socket), async () => {
      throw new Error("cleanup failed");
    });
    await socket.trigger("disconnect", "transport close");

    expect(records).toHaveLength(1);
    expect(records[0].context).toMatchObject({ event: "disconnect" });
    expect(socket.received).toEqual([]);
  });
});

describe("a real call site with no handler-level try/catch", () => {
  it("records a device:slots-init failure once, tells only the causing socket, and leaves a second socket's listener working", async () => {
    const ns = createFakeNamespace();
    const failing = ns.connect("s1");
    const healthy = ns.connect("s2");

    registerDeviceSlotHandler(ns as never, asTyped(failing));
    registerDeviceSlotHandler(ns as never, asTyped(healthy));

    // No payload at all: the handler destructures `{ elementName, sources }`
    // straight out of its own parameter, and registerDeviceSlotHandler has no
    // try/catch anywhere in it — safeOn is the only thing standing between
    // this throw and an unhandled rejection.
    await failing.trigger("device:slots-init");

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      source: "SERVER_SOCKET",
      context: { event: "device:slots-init" },
    });

    expect(failing.received).toEqual([
      { event: "error", payload: { code: "INTERNAL", message: "Something went wrong. Your session is still running." } },
    ]);

    // The second socket, registered on the same namespace, is unaffected: its
    // own listener still runs the real handler logic — proven by the slot
    // manager actually initializing, not merely by the absence of an error —
    // and nothing was ever sent to it.
    healthy.data = { experimentId: "exp-2", participantId: "p-2" };
    const key = "exp-2:p-2:multi-cap";
    await healthy.trigger("device:slots-init", {
      elementName: "multi-cap",
      sources: [{ label: "overhead", capabilities: ["camera"] }],
    });

    expect(deviceSlotManager.getSlots(key)).toEqual([
      expect.objectContaining({ slotLabel: "overhead", claimed: false }),
    ]);
    expect(healthy.received).toEqual([]);
  });
});
