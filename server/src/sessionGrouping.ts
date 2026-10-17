import prisma from "./prisma.js";

/** A resolved group of one seat means that seat paired with nobody. */
const SoloGroupSize = 1;

/** Separator for the CSV `partners` column — a comma would break the CSV. */
const PartnerSeparator = ";";

export interface GroupingRecord {
  sessionId: string;
  progress: number;
  trialNumber: number;
  routineName: string;
  groupIndex: number;
  /** Seats in this group, ascending. Parallel to participantIds. */
  seats: number[];
  /** Participant ids in this group, ordered to match seats. */
  participantIds: string[];
}

/**
 * Upsert the single row describing one interaction group at one progress step.
 *
 * Every member of the group independently resolves the same
 * (sessionId, progress, groupIndex), so N concurrent calls converge on one row
 * via the unique constraint instead of writing N duplicates.
 *
 * `seats` and `participantIds` are written as plain arrays. Prisma also accepts
 * `{ set: [...] }` for a scalar list, but the plain array is what a merging
 * test double stores too, so both agree on the row's shape.
 *
 * Provenance must never break content delivery, so EVERY failure here is logged
 * and swallowed rather than propagated into deliverContent's error path. The
 * catch is deliberately blanket, not sloppy: losing a grouping row costs an
 * analyst one joinable cell, whereas letting this throw would strand a live
 * participant mid-session with an INTERNAL error and cost the experiment a data
 * point. A dead write path is guarded by the prisma mock delegates in the five
 * suites that reach here, which is where that class of bug belongs.
 */
export async function recordSessionGrouping(record: GroupingRecord): Promise<void> {
  const { sessionId, progress, groupIndex, trialNumber, routineName, seats, participantIds } =
    record;
  try {
    await prisma.sessionGrouping.upsert({
      where: {
        sessionId_progress_groupIndex: { sessionId, progress, groupIndex },
      },
      create: {
        sessionId,
        progress,
        groupIndex,
        trialNumber,
        routineName,
        seats,
        participantIds,
      },
      update: {
        trialNumber,
        routineName,
        seats,
        participantIds,
      },
    });
  } catch (err) {
    console.error(
      `[sessionGrouping] Failed to persist grouping for session ${sessionId} at progress ${progress}, group ${groupIndex}:`,
      err,
    );
  }
}

/**
 * Warn when a round-robin rotation leaves a seat on its own inside a cohort
 * that should have paired it. This happens when a seat falls outside the
 * rotation table — a gap in the seat numbers, or a cohort size that is not a
 * multiple of the group size — and today it degrades to a lone participant
 * with no signal anywhere.
 *
 * `seatCount` is the full original cohort size, so a dropped seat never trips
 * this warning by shrinking the table.
 */
export function warnOnSoloRoundRobin(args: {
  patternType: string;
  groupPeers: number[];
  seatCount: number;
  sessionId: string;
  progress: number;
  seat: number;
}): void {
  const { patternType, groupPeers, seatCount, sessionId, progress, seat } = args;
  if (patternType !== "round-robin") return;
  if (groupPeers.length !== SoloGroupSize || seatCount <= SoloGroupSize) return;
  console.warn(
    `[interactionGroup] Round-robin left seat ${seat} alone in a cohort of ${seatCount} (session ${sessionId}, progress ${progress})`,
  );
}

export interface GroupingCsvFields {
  sessionId: string;
  /** Empty string when the row's participant is absent from `participantIds`. */
  seat: number | "";
  groupIndex: number;
  /**
   * The other members of the group as **responseIds**, `;`-joined.
   *
   * The export identifies its rows by `responseId`, and `Participant.id` and
   * `Participant.responseId` are independent uuids, so emitting the internal
   * participant id here would produce values that appear nowhere else in the
   * file and could not be joined against anything.
   */
  partners: string;
}

type IndexableGrouping = Pick<
  GroupingRecord,
  "sessionId" | "progress" | "groupIndex" | "seats" | "participantIds"
>;

/** Composite key joining a flat ExperimentResult row to its grouping. */
export function groupingKey(participantId: string, progress: number): string {
  return `${participantId}:${progress}`;
}

/** Every participant id in these groupings, deduplicated. */
export function collectGroupedParticipantIds(groupings: IndexableGrouping[]): string[] {
  return [...new Set(groupings.flatMap((grouping) => grouping.participantIds))];
}

/**
 * Index grouping rows by participant and progress, so each flat
 * ExperimentResult row can be annotated with its session provenance.
 *
 * The index is KEYED by participant id, because that is what an
 * ExperimentResult row carries, but `partners` is EMITTED as responseIds so it
 * joins against the export's own identity column. `responseIdByParticipantId`
 * is required rather than optional so no caller can silently fall back to
 * emitting internal ids. A partner absent from the map — its Participant row
 * deleted — is omitted rather than emitted as a raw uuid, keeping every value
 * in the column a genuine responseId.
 */
export function indexGroupingsByParticipant(
  groupings: IndexableGrouping[],
  responseIdByParticipantId: Map<string, string>,
): Map<string, GroupingCsvFields> {
  const index = new Map<string, GroupingCsvFields>();
  for (const grouping of groupings) {
    for (const [position, participantId] of grouping.participantIds.entries()) {
      index.set(groupingKey(participantId, grouping.progress), {
        sessionId: grouping.sessionId,
        seat: grouping.seats[position] ?? "",
        groupIndex: grouping.groupIndex,
        partners: grouping.participantIds
          .filter((pid) => pid !== participantId)
          .map((pid) => responseIdByParticipantId.get(pid))
          .filter((responseId): responseId is string => responseId !== undefined)
          .join(PartnerSeparator),
      });
    }
  }
  return index;
}
