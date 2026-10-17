/**
 * How a waiting participant is named in the dashboard, and how long they have
 * been waiting. Pure so both are testable without a DOM.
 */

/** Characters of an internal uuid that identify it in a table without filling the column. */
const ShortIdLength = 8;
const MsPerSecond = 1000;
const SecondsPerMinute = 60;
/** m:ss — a wait of 42 seconds reads "0:42", not "42s". */
const SecondsFieldWidth = 2;

/**
 * A recruitment-platform id is what the person emailing the researcher will
 * quote, and the internal uuid appears nowhere they can see it, so the external
 * id wins whenever the experiment captured one.
 */
export function participantLabel(entry: {
  participantId: string;
  externalId: string | null;
}): string {
  return entry.externalId ?? entry.participantId.slice(0, ShortIdLength);
}

/**
 * `now` is a parameter rather than a `Date.now()` call inside, so the caller's
 * one-second tick decides when this advances. Read internally, a queue that
 * emits no events — a cohort waiting for its eighth member — would show the
 * same wait time until somebody else joined.
 */
export function formatWaitTime(joinedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - joinedAt) / MsPerSecond));
  const minutes = Math.floor(seconds / SecondsPerMinute);
  const remainder = String(seconds % SecondsPerMinute).padStart(SecondsFieldWidth, "0");
  return `${minutes}:${remainder}`;
}
