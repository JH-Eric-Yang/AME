/**
 * One definition of an error report, shared by the participant's browser and
 * the server that stores it.
 *
 * The client truncates before sending so a huge stack never hits the socket;
 * the server truncates again because a report is untrusted input. Neither side
 * may relax these limits independently.
 */

/** Where an error was raised. Mirrored by the Prisma `ErrorSource` enum. */
export type ErrorSource = "SERVER_HTTP" | "SERVER_SOCKET" | "SERVER_TASK" | "CLIENT";

export type ErrorStatus = "OPEN" | "RESOLVED";

/** Maximum stored length per field, in characters. */
export const ErrorLimits = {
  name: 100,
  message: 500,
  stack: 8 * 1024,
  /** Applies to the JSON serialisation of `context`. */
  context: 1024,
} as const;

export interface ClientErrorReport {
  name: string;
  message: string;
  stack?: string;
  routine?: string;
  progress?: number;
  context?: Record<string, unknown>;
}

/** A group as the dashboard receives it. */
export interface StoredErrorGroup {
  id: string;
  source: ErrorSource;
  name: string;
  message: string;
  experimentId: string | null;
  count: number;
  participantCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  status: ErrorStatus;
}

/** One occurrence as the dashboard receives it. */
export interface StoredErrorEvent {
  id: string;
  occurredAt: string;
  participantId: string | null;
  responseId: string | null;
  routine: string | null;
  progress: number | null;
  context: Record<string, unknown> | null;
  stack: string | null;
  message: string;
}

const clip = (value: string, limit: number): string =>
  value.length > limit ? value.slice(0, limit) : value;

/** A signed upload URL must never be stored; the token is the credential. */
export function stripTokens(url: string): string {
  return url.replace(/([?&]token=)[^&]+/g, "$1REDACTED");
}

/** Name, message and stack out of anything that was thrown. */
export function describeError(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return {
      name: clip(err.name, ErrorLimits.name),
      message: clip(err.message, ErrorLimits.message),
      stack: err.stack ? clip(err.stack, ErrorLimits.stack) : undefined,
    };
  }
  if (typeof err === "string") {
    return { name: "Error", message: clip(err, ErrorLimits.message), stack: undefined };
  }
  return { name: "Error", message: clip(safeStringify(err) ?? "Unknown error", ErrorLimits.message), stack: undefined };
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/** Force an untrusted payload into a `ClientErrorReport` within the limits. */
export function truncateReport(payload: unknown): ClientErrorReport {
  const source = (payload ?? {}) as Record<string, unknown>;
  const context = source.context && typeof source.context === "object" ? (source.context as Record<string, unknown>) : undefined;
  const serialised = context ? safeStringify(context) : null;

  return {
    name: typeof source.name === "string" && source.name.length > 0 ? clip(source.name, ErrorLimits.name) : "Error",
    message: typeof source.message === "string" ? clip(source.message, ErrorLimits.message) : "",
    stack: typeof source.stack === "string" ? clip(source.stack, ErrorLimits.stack) : undefined,
    routine: typeof source.routine === "string" ? clip(source.routine, ErrorLimits.name) : undefined,
    progress: typeof source.progress === "number" && Number.isFinite(source.progress) ? source.progress : undefined,
    // `{}` means a context was sent but dropped for exceeding ErrorLimits.context;
    // `undefined` means no context was sent at all. Callers must not conflate the two.
    context: serialised && serialised.length <= ErrorLimits.context ? context : (context ? {} : undefined),
  };
}
