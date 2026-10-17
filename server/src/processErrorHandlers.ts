import { reportError } from "./errors/reportError.js";

/**
 * Bounds a shutdown flush so a hanging database connection cannot wedge a
 * process that is trying to exit.
 */
export const ShutdownFlushTimeoutMs = 1_000;

/** What `installDatabaseSink()` returns — enough to flush and stop on exit. */
export interface ErrorSinkHandle {
  flush: () => Promise<void>;
  stop: () => void;
}

/**
 * Races a flush against `timeoutMs` and resolves as soon as either settles.
 * `flush()` already catches and logs its own failures, so this never rejects;
 * a flush still in flight when the timeout wins is simply abandoned along
 * with the process exiting.
 */
function flushBeforeExit(flush: () => Promise<void>, timeoutMs: number = ShutdownFlushTimeoutMs): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const timer = setTimeout(finish, timeoutMs);
    timer.unref?.();
    void flush().finally(() => {
      clearTimeout(timer);
      finish();
    });
  });
}

/**
 * Process-level safety net for errors no handler caught, and for the buffered
 * error sink's shutdown.
 *
 * Node's default for an unhandled rejection is to exit. Many Socket.IO
 * listeners are `async` and not every path is inside a try, so one failed
 * query in a listener would terminate the process and drop every live
 * participant. A rejection is a single failed operation, not corrupted
 * process state, so it is logged and the server keeps running.
 *
 * An uncaught synchronous exception is different: Node's guidance is that the
 * process is in an unknown state afterwards, so it is logged and the process
 * exits for PM2 to restart. Without `errorSink`, that exit happened before
 * the buffered sink ever got a chance to write anything — the record
 * describing the crash, the highest-value record this system produces, died
 * with the buffer every time. `errorSink.flush` is raced against a short
 * timeout so the exit still happens promptly even if the database is the
 * thing that's down.
 *
 * A clean shutdown (PM2 restart, `Ctrl-C` in dev) sends SIGTERM/SIGINT.
 * Node's default for those is to exit immediately; attaching a handler here
 * means this function now owns calling `process.exit` once the bounded flush
 * settles, so a restart doesn't silently drop whatever the buffer holds.
 */
export function installProcessErrorHandlers(errorSink: ErrorSinkHandle): void {
  process.on("unhandledRejection", (reason) => {
    console.error("[Process] Unhandled promise rejection:", reason);
    reportError(reason, { source: "SERVER_TASK", context: { kind: "unhandledRejection" } });
  });

  process.on("uncaughtException", (err, origin) => {
    console.error(`[Process] Uncaught exception (${origin}), exiting:`, err);
    reportError(err, { source: "SERVER_TASK", context: { kind: "uncaughtException", origin } });
    void flushBeforeExit(errorSink.flush).then(() => process.exit(1));
  });

  const shutdown = (signal: NodeJS.Signals) => {
    errorSink.stop();
    void flushBeforeExit(errorSink.flush).then(() => {
      console.log(`[Process] Flushed buffered errors on ${signal}`);
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
