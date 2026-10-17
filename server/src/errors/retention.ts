/**
 * Keeps the error log bounded (spec §4.4): occurrences expire, groups and their
 * counts do not, so long-run history stays readable while the table stays small.
 */

import prisma from "../prisma.js";

/** Occurrences older than this are deleted outright. */
export const RetentionDays = 30;
/** Newest occurrences kept per group; older surplus is deleted even inside the window. */
export const MaxEventsPerGroup = 100;

const MsPerDay = 24 * 60 * 60 * 1000;
/** How often the sweep runs. */
const SweepIntervalMs = MsPerDay;

export async function sweepErrorEvents(
  now: Date = new Date(),
): Promise<{ deletedByAge: number; deletedByCap: number }> {
  let deletedByAge = 0;
  let deletedByCap = 0;

  try {
    const cutoff = new Date(now.getTime() - RetentionDays * MsPerDay);
    deletedByAge = (await prisma.errorEvent.deleteMany({ where: { occurredAt: { lt: cutoff } } })).count;

    const groups = await prisma.errorEvent.groupBy({ by: ["groupId"], _count: { _all: true } });
    for (const group of groups) {
      if (group._count._all <= MaxEventsPerGroup) continue;

      const surplus = await prisma.errorEvent.findMany({
        where: { groupId: group.groupId },
        orderBy: { occurredAt: "desc" },
        skip: MaxEventsPerGroup,
        select: { id: true },
      });
      if (surplus.length === 0) continue;

      deletedByCap += (
        await prisma.errorEvent.deleteMany({ where: { id: { in: surplus.map((event) => event.id) } } })
      ).count;
    }
  } catch (err) {
    // A failed sweep is a fuller table next time, never a failed request.
    console.error("[errorRetention] Sweep failed:", err);
  }

  return { deletedByAge, deletedByCap };
}

/**
 * Called once from `app.ts`. Never awaited by a request path; `unref()` keeps
 * the interval from holding the process open (matches the pattern in
 * `databaseSink.ts`, `seatSweep.ts`, `sessionDropout.ts`).
 */
export function startErrorRetentionSweep(): void {
  const timer = setInterval(() => void sweepErrorEvents(), SweepIntervalMs);
  timer.unref?.();
}
