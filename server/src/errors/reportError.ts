/**
 * The one way an error becomes a record. Fire-and-forget by contract: it
 * returns synchronously, never throws, and is never awaited on a participant's
 * path, so a slow or broken sink cannot delay or fail a request, a socket
 * listener or a timer (spec §2.2).
 */

import { describeError, stripTokens, type ErrorSource } from "ame-shared/errors";

export interface ErrorContext {
  source: ErrorSource;
  experimentId?: string | null;
  participantId?: string | null;
  responseId?: string | null;
  routine?: string | null;
  progress?: number | null;
  /** `{ method, url }` for HTTP, `{ event }` for sockets, free-form for tasks. Never a request body. */
  context?: Record<string, unknown>;
}

export interface ErrorRecord {
  source: ErrorSource;
  name: string;
  message: string;
  stack?: string;
  experimentId: string | null;
  participantId: string | null;
  responseId: string | null;
  routine: string | null;
  progress: number | null;
  context: Record<string, unknown>;
  occurredAt: Date;
}

export type ErrorSink = (record: ErrorRecord) => void;

/** Keys whose values are URLs, and so may carry a signed media token. */
const UrlKeys = ["url", "originalUrl", "src"];

export const consoleSink: ErrorSink = (record) => {
  console.error(`[${record.source}] ${record.name}: ${record.message}`, {
    experimentId: record.experimentId,
    participantId: record.participantId,
    ...record.context,
  });
};

let sink: ErrorSink = consoleSink;

/** Swap the sink. `app.ts` installs the database sink; tests install a collector. */
export function setErrorSink(next: ErrorSink): void {
  sink = next;
}

function redact(context: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...context };
  for (const key of UrlKeys) {
    if (typeof out[key] === "string") out[key] = stripTokens(out[key]);
  }
  return out;
}

export function reportError(err: unknown, ctx: ErrorContext): void {
  try {
    const { name, message, stack } = describeError(err);
    sink({
      source: ctx.source,
      name,
      message,
      stack,
      experimentId: ctx.experimentId ?? null,
      participantId: ctx.participantId ?? null,
      responseId: ctx.responseId ?? null,
      routine: ctx.routine ?? null,
      progress: ctx.progress ?? null,
      context: redact(ctx.context ?? {}),
      occurredAt: new Date(),
    });
  } catch (sinkFailure) {
    // Logged directly, NOT re-reported: a fault in the reporter must not be
    // able to drive the reporter.
    console.error("[reportError] Sink failed; dropping the report:", sinkFailure);
  }
}
