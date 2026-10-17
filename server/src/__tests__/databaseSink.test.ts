import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createDatabaseSink,
  FlushIntervalMs,
  MaxEventsPerGroupPerMinute,
  MaxGroupsPerFlush,
} from "../errors/databaseSink.js";
import prisma from "../prisma.js";
import type { ErrorRecord } from "../errors/reportError.js";

// Hoisted so these are the SAME mock functions the `$transaction` callback
// closes over on every call. A fresh `vi.fn()` built inside the `vi.mock`
// factory's `$transaction` implementation on every invocation (the original
// shape of this test) makes the upsert/createMany payloads unreachable from
// the tests — see task-5-report.md, fix round 1, Finding 3.
const mocks = vi.hoisted(() => {
  const upsert = vi.fn();
  const createMany = vi.fn();
  const transaction = vi.fn();
  return { upsert, createMany, transaction };
});

vi.mock("../prisma.js", () => ({
  default: {
    errorGroup: { upsert: mocks.upsert },
    errorEvent: { createMany: mocks.createMany },
    $transaction: mocks.transaction,
  },
}));

const record = (over: Partial<ErrorRecord> = {}): ErrorRecord => ({
  source: "SERVER_SOCKET", name: "Error", message: "boom", stack: undefined,
  experimentId: "exp-1", participantId: "p-1", responseId: null, routine: null,
  progress: null, context: {}, occurredAt: new Date(), ...over,
});

beforeEach(() => {
  // vitest.config.ts sets `mockReset: true`, which clears every mock's
  // implementation (not just its call history) before each test — including
  // ones set inside a `vi.mock` factory, since that factory runs once at
  // module load, before the very first reset. So the transaction/upsert
  // implementations are (re-)established here, every test, rather than once
  // at the top of the file.
  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ errorGroup: { upsert: mocks.upsert }, errorEvent: { createMany: mocks.createMany } }),
  );
  mocks.upsert.mockResolvedValue({ id: "g-1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("createDatabaseSink", () => {
  it("uses the spec'd cap and interval values", () => {
    // Pinned literally so changing one of these (e.g. 20 -> 5) fails a test
    // instead of silently drifting — the earlier cap tests only import the
    // constants, so they can't detect that kind of change.
    expect([FlushIntervalMs, MaxEventsPerGroupPerMinute, MaxGroupsPerFlush]).toEqual([5_000, 20, 500]);
  });

  it("writes nothing until it is flushed", () => {
    const { sink } = createDatabaseSink();
    sink(record());
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("upserts one group per fingerprint, pinning the create and update payloads", async () => {
    const { sink, flush } = createDatabaseSink();
    sink(record());
    sink(record({ participantId: "p-2" }));
    await flush();

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    const [payload] = mocks.upsert.mock.calls[0];
    expect(payload.create).toMatchObject({ count: 2 });
    // The reopen shape: a returning bug on a RESOLVED group must never stay
    // hidden, so every update clears status/resolvedAt/resolvedById too.
    expect(payload.update).toEqual({
      count: { increment: 2 },
      lastSeenAt: expect.any(Date),
      status: "OPEN",
      resolvedAt: null,
      resolvedById: null,
    });
  });

  it("stops storing events past the per-group cap but keeps counting", async () => {
    const { sink, pending } = createDatabaseSink();
    for (let i = 0; i < MaxEventsPerGroupPerMinute + 10; i += 1) sink(record());

    const group = pending()[0];
    expect(group.events).toHaveLength(MaxEventsPerGroupPerMinute);
    expect(group.count).toBe(MaxEventsPerGroupPerMinute + 10);
  });

  it("drops new groups past the buffer cap, warning once", async () => {
    // Differentiate by `name`, not `message`: normaliseMessage strips digits
    // (by design — see errorFingerprint.test.ts), so a purely numeric suffix
    // on the message would collapse every iteration into one fingerprint.
    const { sink, pending } = createDatabaseSink();
    for (let i = 0; i < MaxGroupsPerFlush + 5; i += 1) sink(record({ name: `Error${i}` }));

    expect(pending()).toHaveLength(MaxGroupsPerFlush);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("swallows a failed flush, logs it, and drops the batch", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("db down"));
    const { sink, flush, pending } = createDatabaseSink();
    sink(record());

    await expect(flush()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
    expect(pending()).toHaveLength(0);
  });

  it("a failing group does not stop the other groups in the same flush", async () => {
    // Each group now writes in its own transaction (fix round 1, Finding 2),
    // so a mocked rejection on the first call must only cost that group.
    mocks.transaction.mockRejectedValueOnce(new Error("group A's write failed"));
    const { sink, flush } = createDatabaseSink();
    sink(record({ name: "ErrorA" }));
    sink(record({ name: "ErrorB" }));
    await flush();

    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    // Group A's transaction rejected before ever calling its callback, so
    // only group B's upsert ran.
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("clears the buffer after a successful flush", async () => {
    const { sink, flush, pending } = createDatabaseSink();
    sink(record());
    await flush();
    expect(pending()).toHaveLength(0);
  });

  it("refuses to run a second flush while one is still in flight", async () => {
    // A flush slower than FlushIntervalMs must not stack a second interactive
    // transaction against the same pool live participants are using.
    let releaseFirstWrite: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    mocks.transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
      await gate;
      return fn({ errorGroup: { upsert: mocks.upsert }, errorEvent: { createMany: mocks.createMany } });
    });

    const { sink, flush, pending } = createDatabaseSink();
    sink(record({ name: "ErrorA" }));
    const firstFlush = flush();
    // Let the first flush get past its `buffer.size === 0` check and into the
    // gated transaction before anything else runs.
    await Promise.resolve();

    sink(record({ name: "ErrorB" }));
    const secondFlush = flush();
    releaseFirstWrite!();
    await Promise.all([firstFlush, secondFlush]);

    // Only ErrorA's transaction ran; the second flush call returned
    // immediately instead of racing it, so ErrorB is still buffered.
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(pending()).toHaveLength(1);
    expect(pending()[0].first.name).toBe("ErrorB");
  });
});
