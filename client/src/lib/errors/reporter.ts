/**
 * Records a failure in the participant's browser (spec §5).
 *
 * Silent: nothing here changes what the participant sees. Only an Alert event
 * pauses an experiment. Reports are dropped, never queued, when no socket is
 * connected — the reconnect re-reports anything still failing.
 */

import { get } from "svelte/store";
import { describeError, truncateReport, type ClientErrorReport } from "ame-shared/errors";
import { getSocket } from "$lib/socket/experimentSocket";
import { runner } from "$lib/stores/runner";

/** Pure: what gets sent, given an error and where the participant was. */
export function buildReport(
  err: unknown,
  state: { routine?: string; progress?: number },
  context?: Record<string, unknown>,
): ClientErrorReport {
  const { name, message, stack } = describeError(err);
  return truncateReport({ name, message, stack, routine: state.routine, progress: state.progress, context });
}

export function reportClientError(err: unknown, context?: Record<string, unknown>): void {
  try {
    const socket = getSocket();
    if (!socket?.connected) return;

    const state = get(runner);
    socket.emit("client:error", buildReport(err, { routine: state.routine?.name, progress: state.progress }, context));
  } catch { /* never re-enter: this runs inside the window `error` listener */ }
}

/** Install the window-level listeners. Returns the uninstall function. */
export function installErrorReporting(): () => void {
  const onError = (event: ErrorEvent): void => {
    reportClientError(event.error ?? event.message, { kind: "window.onerror", source: event.filename });
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    reportClientError(event.reason, { kind: "unhandledrejection" });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
