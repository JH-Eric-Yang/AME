/**
 * What to tell a participant while their session waits at the proceed barrier.
 *
 * The server broadcasts only a count (`exp:sync`), the same number that decides
 * the release. Which of the two sentences a participant reads depends on
 * something the server never sends: whether *they* are one of the members who
 * has already submitted. That is local knowledge — the client set it when it
 * asked to proceed — so the split is made here rather than per recipient.
 */
export interface CohortSync {
  submitted: number;
  total: number;
  /**
   * The progress this count belongs to. A member still being served their
   * content receives the event before their own `exp:content`, so the store
   * keeps a sync whose progress matches the content that follows and discards
   * one left over from an earlier routine.
   */
  progress: number;
}

export interface CohortNotice {
  text: string;
  /** True when this participant is the one being waited on. */
  waiting: boolean;
}

/**
 * Routines the participant does not answer. Both advance themselves the moment
 * they mount, so the barrier they cross is machinery rather than a submission —
 * telling someone they are "waiting for the others" on a screen they never
 * acted on is noise, and the banner shifts the waiting spinner off centre.
 */
const UnattendedRoutines = new Set(["routine-matching", "routine-end-matching"]);

export function showsCohortNotice(routineType: string | undefined): boolean {
  return routineType !== undefined && !UnattendedRoutines.has(routineType);
}

export function cohortNotice(
  sync: CohortSync | null,
  hasSubmitted: boolean,
): CohortNotice | null {
  if (!sync) return null;
  // A session of one has nobody to wait for, and a count that has reached its
  // total is a released barrier whose content is already on its way. Neither
  // is worth a notice.
  if (sync.total < 2 || sync.submitted < 1) return null;
  if (sync.submitted >= sync.total) return null;

  if (hasSubmitted) {
    return {
      text: `Submitted — waiting for the others (${sync.submitted} of ${sync.total})`,
      waiting: true,
    };
  }
  return {
    text: `${sync.submitted} of ${sync.total} submitted — waiting for you`,
    waiting: false,
  };
}

/**
 * Identity of the notice currently worth showing, or null when there is none.
 *
 * The popup is dismissable, and a dismissal must not silence the NEXT thing
 * that happens: when a third member submits, or the participant crosses into
 * another routine, the count is news again. Comparing this key against the one
 * that was dismissed re-opens the popup exactly then, and keeps it shut while
 * nothing has changed.
 */
export function noticeKey(
  sync: CohortSync | null,
  hasSubmitted: boolean,
): string | null {
  if (!sync || !cohortNotice(sync, hasSubmitted)) return null;
  return `${sync.progress}:${sync.submitted}:${sync.total}:${hasSubmitted}`;
}
