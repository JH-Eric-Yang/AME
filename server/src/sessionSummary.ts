import type { Prisma } from "@prisma/client";
import type {
  SessionGroupingSummary,
  SessionSeatSummary,
  SessionSummary,
} from "ame-shared";
import type { SessionDesign } from "ame-shared/sessionDesign";
import prisma from "./prisma.js";

/** Exactly the two fields a summary needs off a design, so a growing SessionDesign never reaches here. */
type BlockName = Pick<SessionDesign, "id" | "label">;

/**
 * Grouping rows are read newest-progress-first and only the newest progress is
 * kept, so this bound only has to exceed the number of groups a single session
 * can hold at one progress — a cohort of 24 in dyads is 12. 64 leaves ample
 * headroom while keeping one session's read bounded.
 */
const MaxGroupingRowsPerSession = 64;

/**
 * How many sessions one read returns, newest first.
 *
 * A long-running experiment accumulates a session per cohort, and every one of
 * them drags its seats and grouping rows along: 300 finished 8-seat cohorts is
 * roughly 21,000 rows in a single round trip, to paint cards nobody scrolls to.
 * 50 is far more than a researcher reads at once and bounds both the socket
 * snapshot and the dashboard's first paint.
 */
const MaxSessionsPerLoad = 50;

export interface SessionSeatRow {
  participantId: string;
  seat: number;
  slotName: string | null;
  status: "ACTIVE" | "DROPPED";
  participant: { externalId: string | null; progress: number } | null;
}

export interface SessionGroupingRow {
  progress: number;
  trialNumber: number;
  groupIndex: number;
  seats: number[];
  participantIds: string[];
}

/** The Prisma row shape `summarizeSession` reads, named so it can be built in a test. */
export interface SessionRow {
  id: string;
  experimentId: string;
  routineName: string;
  blockId: string | null;
  status: "WAITING" | "ACTIVE" | "CLOSED";
  matchProgress: number;
  matchedAt: Date | null;
  participants: SessionSeatRow[];
  groupings: SessionGroupingRow[];
}

/**
 * Flatten one session into the shape the dashboard renders.
 *
 * Pure: it takes rows and returns a payload, so the run-time monitor is
 * testable without a database, a socket or a browser.
 *
 * `seatCount` is the FULL participants array and never the active subset — it
 * is the cohort the rotation schedule was computed from, and shrinking it would
 * misreport an 8-person round-robin as a 7-person one the moment somebody
 * closed their tab.
 */
export function summarizeSession(
  row: SessionRow,
  designs: BlockName[] = [],
): SessionSummary {
  const seats = [...row.participants]
    .sort((a, b) => a.seat - b.seat)
    .map<SessionSeatSummary>((member) => ({
      seat: member.seat,
      slotName: member.slotName,
      participantId: member.participantId,
      externalId: member.participant?.externalId ?? null,
      status: member.status,
      progress: member.participant?.progress ?? 0,
    }));

  const currentProgress = row.groupings.reduce<number | null>(
    (latest, group) =>
      latest === null || group.progress > latest ? group.progress : latest,
    null,
  );

  const groupings = row.groupings
    .filter((group) => group.progress === currentProgress)
    .sort((a, b) => a.groupIndex - b.groupIndex)
    .map<SessionGroupingSummary>((group) => ({
      progress: group.progress,
      trialNumber: group.trialNumber,
      groupIndex: group.groupIndex,
      seats: [...group.seats].sort((a, b) => a - b),
      participantIds: group.participantIds,
    }));

  return {
    sessionId: row.id,
    experimentId: row.experimentId,
    routineName: row.routineName,
    blockId: row.blockId,
    // Resolved rather than stored, so renaming a block renames its live sessions.
    blockLabel: row.blockId
      ? (designs.find((design) => design.id === row.blockId)?.label ?? null)
      : null,
    status: row.status,
    matchProgress: row.matchProgress,
    matchedAt: row.matchedAt ? row.matchedAt.toISOString() : null,
    seatCount: row.participants.length,
    activeSeatCount: row.participants.filter((member) => member.status === "ACTIVE")
      .length,
    seats,
    currentProgress,
    currentTrialNumber: groupings[0]?.trialNumber ?? null,
    groupings,
  };
}

/**
 * The one include shared by both loaders, so the REST endpoint and the socket
 * snapshot can never disagree about what a session summary is made of.
 *
 * `satisfies` rather than `as const`: it keeps the sort literals narrow enough
 * for Prisma while leaving the object mutable, so the inferred row assigns to
 * SessionRow directly and no cast is needed.
 */
const SessionInclude = {
  participants: {
    include: { participant: { select: { externalId: true, progress: true } } },
  },
  groupings: {
    orderBy: [{ progress: "desc" }, { groupIndex: "asc" }],
    take: MaxGroupingRowsPerSession,
  },
} satisfies Prisma.SessionInclude;

export interface LoadSessionsOptions {
  /**
   * Drop CLOSED sessions. The live socket snapshot wants only what is still
   * running — a finished cohort cannot change again, so streaming it to a
   * dashboard that is watching for changes is pure weight.
   */
  activeOnly?: boolean;
}

/**
 * The one extra join `loadSessionSummary` makes on top of `SessionInclude`.
 *
 * Only the single-session loader takes it. `pushAdminSessionUpdate` calls that
 * loader on every content delivery of every cohort member, so a second round
 * trip there is a per-seat-per-proceed cost; folding it into the read the loader
 * already makes removes it entirely. The LIST loader deliberately does not join
 * this — it would carry one full copy of the designs JSON per session row — and
 * reads the designs once instead.
 */
const BlockNameInclude = {
  experiment: { select: { sessionDesigns: true } },
} satisfies Prisma.SessionInclude;

/** The designs off whichever row shape carried them, as names only. */
function blockNamesFrom(sessionDesigns: unknown): BlockName[] {
  return Array.isArray(sessionDesigns)
    ? (sessionDesigns as unknown as BlockName[])
    : [];
}

/**
 * The experiment's session blocks, as names only.
 *
 * Read once per list load rather than joined onto every session row.
 *
 * @param experimentId the experiment whose blocks are wanted.
 * @returns the blocks' ids and labels; empty for an experiment that declares none.
 */
async function loadBlockNames(experimentId: string): Promise<BlockName[]> {
  const experiment = await prisma.experiment.findUnique({
    where: { id: experimentId },
    select: { sessionDesigns: true },
  });
  return blockNamesFrom(experiment?.sessionDesigns);
}

export async function loadSessionSummaries(
  experimentId: string,
  options: LoadSessionsOptions = {},
): Promise<SessionSummary[]> {
  const rows = await prisma.session.findMany({
    where: options.activeOnly
      ? { experimentId, status: { not: "CLOSED" } }
      : { experimentId },
    orderBy: { createdAt: "desc" },
    take: MaxSessionsPerLoad,
    include: SessionInclude,
  });
  const designs = await loadBlockNames(experimentId);
  // Never a bare `rows.map(summarizeSession)`: map would hand the row index in
  // as `designs` and the label lookup would throw.
  return rows.map((row) => summarizeSession(row, designs));
}

export async function loadSessionSummary(
  sessionId: string,
): Promise<SessionSummary | null> {
  const row = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { ...SessionInclude, ...BlockNameInclude },
  });
  if (!row) return null;
  return summarizeSession(row, blockNamesFrom(row.experiment?.sessionDesigns));
}
