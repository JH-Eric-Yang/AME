import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installProcessErrorHandlers, ShutdownFlushTimeoutMs, type ErrorSinkHandle } from "../processErrorHandlers.js";

type Handler = (...args: unknown[]) => void;

describe("installProcessErrorHandlers", () => {
  let handlers: Record<string, Handler>;

  beforeEach(() => {
    handlers = {};
    // `process.on` is mocked outright (not just spied-and-passed-through): a
    // real SIGTERM/SIGINT listener attached to the actual test process would
    // outlive the test, and calling the real handler would try to exit the
    // vitest worker.
    vi.spyOn(process, "on").mockImplementation(((event: string, handler: Handler) => {
      handlers[event] = handler;
      return process;
    }) as typeof process.on);
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const handle = (over: Partial<ErrorSinkHandle> = {}): ErrorSinkHandle => ({
    flush: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    ...over,
  });

  it("reports and logs an unhandled rejection without touching the sink", () => {
    const errorSink = handle();
    installProcessErrorHandlers(errorSink);

    handlers.unhandledRejection(new Error("rejected"));

    expect(console.error).toHaveBeenCalled();
    expect(errorSink.flush).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it("flushes the buffered errors before exiting on an uncaught exception", async () => {
    const errorSink = handle();
    installProcessErrorHandlers(errorSink);

    handlers.uncaughtException(new Error("boom"), "uncaughtException");
    await vi.advanceTimersByTimeAsync(0);

    expect(errorSink.flush).toHaveBeenCalledTimes(1);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("still exits on an uncaught exception if the flush hangs, after the bounded timeout", async () => {
    const flush = vi.fn(() => new Promise<void>(() => {})); // never settles
    const errorSink = handle({ flush });
    installProcessErrorHandlers(errorSink);

    handlers.uncaughtException(new Error("boom"), "uncaughtException");
    expect(process.exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(ShutdownFlushTimeoutMs);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(process.exit).toHaveBeenCalledTimes(1);

    // The still-hanging flush settling later (or more time passing) must not
    // exit the process a second time.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(process.exit).toHaveBeenCalledTimes(1);
  });

  it("stops the timer and flushes on SIGTERM, then exits 0", async () => {
    const errorSink = handle();
    installProcessErrorHandlers(errorSink);

    handlers.SIGTERM();
    await vi.advanceTimersByTimeAsync(0);

    expect(errorSink.stop).toHaveBeenCalledTimes(1);
    expect(errorSink.flush).toHaveBeenCalledTimes(1);
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it("stops the timer and flushes on SIGINT, then exits 0", async () => {
    const errorSink = handle();
    installProcessErrorHandlers(errorSink);

    handlers.SIGINT();
    await vi.advanceTimersByTimeAsync(0);

    expect(errorSink.stop).toHaveBeenCalledTimes(1);
    expect(errorSink.flush).toHaveBeenCalledTimes(1);
    expect(process.exit).toHaveBeenCalledWith(0);
  });
});
