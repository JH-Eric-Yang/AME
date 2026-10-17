import type { MatchingConfig } from "ame-shared";

/**
 * Decides whether a routine should emit `match:join` on mount.
 *
 * `match:join` is destructive on the server: it begins with `closeActiveSessions`,
 * which tears down the cohort and resets `matchProgress`, so it must be emitted
 * exactly once per matching block and never by a routine that only rides on an
 * already-formed session.
 *
 * @param routine the routine currently being rendered, or null before the first
 *        `exp:content` arrives.
 * @param sessionId the participant's live session id. Empty string counts as no
 *        session — `routine-end-matching` clears the session by calling
 *        `runner.setMatched("", [], 0, "")`.
 * @param alreadyEmitted the caller's own latch, so a re-run never double-joins.
 */
export function shouldEmitMatchJoin(
  routine: { matching: MatchingConfig | null } | null,
  sessionId: string | null,
  alreadyEmitted: boolean,
): boolean {
  if (alreadyEmitted) return false;
  if (!routine?.matching) return false;
  return !sessionId;
}
