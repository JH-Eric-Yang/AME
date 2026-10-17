import type { CompiledBlock } from "ame-shared/sessionDesign";
import type { ApplyState } from "./applyBarView";

/**
 * The two writes Generate & Save performs, in order. Injected rather than
 * imported so the sequence can be tested without a network or a DOM;
 * SessionDesignerTab supplies the real API calls.
 */
export interface ApplyIo {
  /** PUT /api/admin/experiments/:id — routines, sessionDesigns, conditions, participantsPerSession. */
  saveRoutines: () => Promise<void>;
  /** PUT /api/admin/experiments/:id/content — the compiled rows and the band they replace. */
  uploadContent: () => Promise<void>;
}

export interface ApplyOutcome {
  state: Exclude<ApplyState, "applying">;
  error: string | null;
}

const UnknownErrorMessage = "Unexpected error while saving the session block";

export function applyErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : UnknownErrorMessage;
}

/**
 * Run both writes. A failure of the first leaves the experiment untouched, so
 * the bar returns to `idle` and offers Generate & Save again. A failure of the
 * second is the half-write the design forbids hiding: it becomes
 * `routines-only`, which the bar renders with a Retry upload action.
 */
export async function runApply(io: ApplyIo): Promise<ApplyOutcome> {
  try {
    await io.saveRoutines();
  } catch (error) {
    return { state: "idle", error: applyErrorMessage(error) };
  }

  return uploadOnly(io);
}

/**
 * Whether the Builder may now adopt the block's routines. `idle` is the one
 * outcome where the first write never landed, so the server holds nothing —
 * adopting there would leave the compile plan describing a rewrite of routines
 * only the browser has ever seen, and would leave the drift check comparing the
 * compile against a local copy of itself.
 */
export function shouldAdoptRoutines(outcome: ApplyOutcome): boolean {
  return outcome.state !== "idle";
}

/**
 * Whether Generate & Save may begin.
 *
 * `inFlight` is NOT the same thing as the bar reading "Saving…": every edit
 * resets the apply state to `idle` — an edit does invalidate whatever the last
 * apply reported — and that on its own would re-enable the button while both
 * writes were still running. A second press then puts two `PUT …/content` calls
 * with DIFFERENT replace bands in the air at once: Postgres keeps whichever
 * lands last, the bar prints whichever SEQUENCE finishes last, and the two need
 * not be the same write. This is the one guard that stops that.
 */
export function canStartApply(compiled: CompiledBlock | null, inFlight: boolean): boolean {
  return compiled !== null && !inFlight;
}

/**
 * What the bar must show once a write finishes, given whether the design was
 * edited while it ran (`stale`).
 *
 * A stale outcome may not set the STATE — "Applied · 7 rows written" over a
 * design that now compiles to nine rows is exactly the confidently-wrong number
 * this feature exists to prevent, and `routines-only` is no safer: its Retry
 * upload sends only content, which would push the EDITED design's rows against
 * the routines saved for the old one. The edit already returned the bar to
 * `idle`, whose Generate & Save re-writes both halves and repairs either case.
 *
 * The ERROR is surfaced regardless. It is a fact about the server, not about
 * the design on screen, and swallowing it leaves a half-written experiment
 * under a bar that reads "ready".
 */
export function applyDisplay(outcome: ApplyOutcome, stale: boolean): ApplyOutcome {
  if (!stale) return outcome;
  return { state: "idle", error: outcome.error };
}

/** The Retry upload path: the routines are already saved, so only content is written. */
export async function uploadOnly(io: Pick<ApplyIo, "uploadContent">): Promise<ApplyOutcome> {
  try {
    await io.uploadContent();
  } catch (error) {
    return { state: "routines-only", error: applyErrorMessage(error) };
  }

  return { state: "applied", error: null };
}
