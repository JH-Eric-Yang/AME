/**
 * roleBalance — what the Participants tab reports about achieved balance.
 *
 * A session that was abandoned still consumed its permutation, so the intended
 * balance and the ACHIEVED balance diverge. The line exists to make that
 * divergence visible, which is only true if it counts the people whose data a
 * researcher will actually analyse.
 *
 * Only a TYPE is imported from `ame-shared`, which is always safe in client
 * code — it is a runtime VALUE import from that package that client vitest
 * cannot resolve.
 */

import type { RoutineConfig } from "ame-shared";

/**
 * The participant fields this report reads; the API returns rather more.
 *
 * Every field is `unknown` because the tab holds the API's rows untyped, and a
 * narrower shape here would only be reached through a cast that asserts more
 * than the caller knows.
 */
export interface BalanceParticipant {
  role?: unknown;
  completion?: unknown;
  withdraw?: unknown;
}

/**
 * True when this participant's role is worth counting.
 *
 * Everyone who has not reached a matching routine is still sitting on the
 * schema default of 0, so counting all participants makes the line report the
 * unassigned rather than the assigned — on a study with a solo phase before
 * matching, they dominate it. Withdrawals are excluded for the same reason
 * `statusLabel` shows them as withdrawn rather than complete: their role was
 * dealt but their data is not part of the achieved design.
 */
function counts(participant: BalanceParticipant): boolean {
  return Boolean(participant.completion) && !participant.withdraw;
}

/** How many COMPLETED participants finished in each role index. */
export function achievedRoleCounts(
  participants: BalanceParticipant[],
): Record<number, number> {
  return participants.filter(counts).reduce<Record<number, number>>((acc, p) => {
    const role = Number(p.role ?? 0) || 0;
    acc[role] = (acc[role] ?? 0) + 1;
    return acc;
  }, {});
}

/**
 * The line shown under the heading, or null when there is nothing to report.
 *
 * Null rather than an empty string so the caller renders no element at all —
 * a bare "Achieved balance —" says less than nothing.
 */
export function achievedBalanceLine(participants: BalanceParticipant[]): string | null {
  const entries = Object.entries(achievedRoleCounts(participants));
  if (entries.length === 0) return null;

  return entries
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([role, n]) => `role ${role}: ${n}`)
    .join(" · ");
}

/**
 * True when any routine forms a cohort, and therefore assigns a role.
 *
 * An experiment with no matching never writes a role, so every participant
 * holds the default and the line would report a balance that describes
 * nothing about the study.
 */
export function experimentAssignsRoles(routines: RoutineConfig[]): boolean {
  return routines.some((routine) => routine.matching != null);
}
