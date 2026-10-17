/**
 * A participant's browser reporting its own failure (spec §5).
 *
 * Silent by design: the report is recorded and nothing is sent back, because
 * every `error` event becomes a banner on the participant's screen and a
 * camera warning is not a reason to interrupt an experiment.
 */

import { truncateReport } from "ame-shared/errors";
import { FixedWindowRateLimiter } from "../middleware/rateLimit.js";
import { reportError } from "../errors/reportError.js";
import { safeOn } from "./safeListener.js";
import type { TypedSocket, SocketState } from "./index.js";

/** Far above a genuinely broken page, far below anything worth scripting. */
export const MaxClientReportsPerWindow = 20;
export const ClientReportWindowMs = 60_000;

export function registerClientErrorHandler(
  socket: TypedSocket,
  limiter: FixedWindowRateLimiter = new FixedWindowRateLimiter(MaxClientReportsPerWindow, ClientReportWindowMs),
): void {
  safeOn(socket, "client:error", (payload) => {
    const state = socket.data as SocketState;
    // Before `exp:join` there is no participant to attribute the report to.
    if (!state.experimentId || !state.participantId) return;
    if (!limiter.check(socket.id, Date.now()).allowed) return;

    const report = truncateReport(payload);
    // `reportError` takes the thrown value, so the report's own `name` (the
    // browser's real error class, e.g. NotAllowedError) travels in `context`
    // rather than becoming the group's top-level `name`. Do not fabricate an
    // `Error` subclass here to work around that — it is accepted for this
    // phase (see task brief decision #5).
    const error = new Error(report.message);
    // Without this, `error.stack` is the SERVER-side trace through this
    // handler — the same constant frame for every client group, which is
    // both the wrong file for a researcher to look at and useless for
    // fingerprinting (every browser failure would group together).
    if (report.stack) error.stack = report.stack;
    reportError(error, {
      source: "CLIENT",
      experimentId: state.experimentId,
      participantId: state.participantId,
      responseId: state.responseId ?? null,
      routine: report.routine ?? null,
      progress: report.progress ?? null,
      context: { ...report.context, name: report.name },
    });
  });
}
