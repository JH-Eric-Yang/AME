import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  summarizeSession,
  loadSessionSummaries,
  loadSessionSummary,
  type SessionRow,
} from "../sessionSummary.js";
import prisma from "../prisma.js";

// prisma.ts constructs a PrismaClient at import time; sessionSummary.ts imports
// it for its loaders. summarizeSession is pure, so an inert stub is enough.
vi.mock("../prisma.js", () => ({
  default: {
    session: { findMany: vi.fn(), findUnique: vi.fn() },
    // The loaders resolve each session's block id to its label, so they read
    // the experiment's designs once per load.
    experiment: { findUnique: vi.fn() },
  },
}));

const ExperimentId = "exp-monitor-1";
const SessionId = "a41c88f0-1111-2222-3333-444455556666";
const MatchedAt = new Date("2026-09-06T10:00:00.000Z");

/** Trial 4 of the 8-seat round-robin, 0-based: seats 0-3, 2-4, 1-5, 6-7. */
const TrialFourProgress = 5;
const TrialFourNumber = 4;

const seat = (
  index: number,
  externalId: string | null,
  status: "ACTIVE" | "DROPPED",
  progress: number,
) => ({
  participantId: `p-${index}`,
  seat: index,
  slotName: `seat-${index}`,
  status,
  participant: { externalId, progress },
});

const grouping = (groupIndex: number, seats: number[], progress = TrialFourProgress) => ({
  progress,
  trialNumber: progress === TrialFourProgress ? TrialFourNumber : TrialFourNumber - 1,
  groupIndex,
  seats,
  participantIds: seats.map((s) => `p-${s}`),
});

const cohortRow = (): SessionRow => ({
  id: SessionId,
  experimentId: ExperimentId,
  routineName: "Chat-match",
  // Nothing writes Session.blockId yet — a later task adds the writer — so the
  // runtime value is null and the heading falls back to routineName.
  blockId: null,
  status: "ACTIVE",
  matchProgress: 1,
  matchedAt: MatchedAt,
  participants: [
    // Deliberately out of seat order: the DB returns insertion order.
    seat(3, null, "ACTIVE", 5),
    seat(0, null, "ACTIVE", 5),
    seat(1, "PROLIFIC_6KD2", "ACTIVE", 5),
    seat(2, null, "DROPPED", 3),
    seat(4, null, "ACTIVE", 5),
    seat(5, null, "ACTIVE", 5),
    seat(6, null, "ACTIVE", 5),
    seat(7, null, "ACTIVE", 5),
  ],
  groupings: [
    // Newest progress first, as loadSessionSummaries orders them.
    grouping(0, [0, 3]),
    grouping(1, [4]), // seat 2 dropped, so this group persisted with one seat
    grouping(2, [1, 5]),
    grouping(3, [6, 7]),
    grouping(0, [0, 4], TrialFourProgress - 1),
    grouping(1, [1, 2], TrialFourProgress - 1),
  ],
});

describe("summarizeSession", () => {
  it("orders seats ascending regardless of row order", () => {
    const summary = summarizeSession(cohortRow());
    expect(summary.seats.map((s) => s.seat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("carries externalId, status and per-seat progress through", () => {
    const summary = summarizeSession(cohortRow());
    expect(summary.seats[1].externalId).toBe("PROLIFIC_6KD2");
    expect(summary.seats[2]).toMatchObject({ status: "DROPPED", progress: 3 });
    expect(summary.seats[0]).toMatchObject({ status: "ACTIVE", progress: 5, externalId: null });
  });

  it("counts the full cohort and the seats still active separately", () => {
    const summary = summarizeSession(cohortRow());
    // seatCount must NOT shrink on a dropout: it is the cohort the rotation
    // schedule was built from.
    expect(summary.seatCount).toBe(8);
    expect(summary.activeSeatCount).toBe(7);
  });

  it("keeps only the newest progress's groupings, ordered by groupIndex", () => {
    const summary = summarizeSession(cohortRow());
    expect(summary.currentProgress).toBe(TrialFourProgress);
    expect(summary.currentTrialNumber).toBe(TrialFourNumber);
    expect(summary.groupings.map((g) => g.seats)).toEqual([[0, 3], [4], [1, 5], [6, 7]]);
  });

  it("reports no current progress before the first grouping is written", () => {
    const summary = summarizeSession({ ...cohortRow(), groupings: [] });
    expect(summary.currentProgress).toBeNull();
    expect(summary.currentTrialNumber).toBeNull();
    expect(summary.groupings).toEqual([]);
    expect(summary.matchedAt).toBe(MatchedAt.toISOString());
  });

  it("passes blockId through untouched, null until a writer stamps it", () => {
    expect(summarizeSession(cohortRow()).blockId).toBeNull();
    expect(summarizeSession({ ...cohortRow(), blockId: "blk1" }).blockId).toBe("blk1");
  });
});

describe("loadSessionSummaries", () => {
  // mockReset is global in server/vitest.config.ts, so the implementation is
  // installed per test rather than at module scope.
  beforeEach(() => {
    vi.mocked(prisma.session.findMany).mockResolvedValue([] as never);
  });

  it("bounds one read, so a long-running experiment cannot ship every cohort it ever ran", async () => {
    await loadSessionSummaries(ExperimentId);

    const [args] = vi.mocked(prisma.session.findMany).mock.calls[0] as [
      { take: number; orderBy: unknown; where: Record<string, unknown> },
    ];
    expect(args.take).toBe(50);
    expect(args.orderBy).toEqual({ createdAt: "desc" });
  });

  it("includes closed sessions by default — the REST view is the history view", async () => {
    await loadSessionSummaries(ExperimentId);

    const [args] = vi.mocked(prisma.session.findMany).mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(args.where).toEqual({ experimentId: ExperimentId });
  });

  it("drops closed sessions for the live snapshot, which exists to watch for change", async () => {
    await loadSessionSummaries(ExperimentId, { activeOnly: true });

    const [args] = vi.mocked(prisma.session.findMany).mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(args.where).toEqual({
      experimentId: ExperimentId,
      status: { not: "CLOSED" },
    });
  });
});

describe("summarizeSession block label", () => {
  const BlockId = "blk-chat";
  const BlockLabel = "Chat block";

  /** Only the two fields summarizeSession reads, so a growing SessionDesign never touches this. */
  const designs = [
    { id: BlockId, label: BlockLabel },
    { id: "blk-other", label: "Debrief block" },
  ];

  const rowInBlock = (): SessionRow => ({ ...cohortRow(), blockId: BlockId });

  it("resolves the stored block id to the design's label", () => {
    const summary = summarizeSession(rowInBlock(), designs);
    expect(summary.blockId).toBe(BlockId);
    expect(summary.blockLabel).toBe(BlockLabel);
  });

  it("leaves the label null when the design that created the session is gone", () => {
    const summary = summarizeSession(rowInBlock(), [
      { id: "blk-other", label: "Debrief block" },
    ]);
    expect(summary.blockId).toBe(BlockId);
    expect(summary.blockLabel).toBeNull();
  });

  it("leaves the label null for a session no block created", () => {
    const summary = summarizeSession({ ...cohortRow(), blockId: null }, designs);
    expect(summary.blockLabel).toBeNull();
  });

  it("defaults the designs to none, so an unwired caller still summarizes", () => {
    expect(summarizeSession(rowInBlock()).blockLabel).toBeNull();
  });
});

describe("loadSessionSummary", () => {
  const BlockId = "blk-chat";

  // mockReset is global in server/vitest.config.ts, so implementations are
  // installed per test rather than at module scope.
  beforeEach(() => {
    vi.mocked(prisma.session.findUnique).mockResolvedValue({
      ...cohortRow(),
      blockId: BlockId,
      experiment: { sessionDesigns: [{ id: BlockId, label: "Chat block" }] },
    } as never);
  });

  it("names the block from the row it already read, without a second query", async () => {
    const summary = await loadSessionSummary(SessionId);

    expect(summary?.blockLabel).toBe("Chat block");
    // pushAdminSessionUpdate calls this on every content delivery of every
    // cohort member, so an extra round trip here is a per-seat-per-proceed cost.
    expect(prisma.experiment.findUnique).not.toHaveBeenCalled();
  });

  it("joins the designs onto the single-session read", async () => {
    await loadSessionSummary(SessionId);

    const [args] = vi.mocked(prisma.session.findUnique).mock.calls[0] as [
      { include: Record<string, unknown> },
    ];
    expect(args.include.experiment).toEqual({ select: { sessionDesigns: true } });
    // The summary fields still come from the shared include.
    expect(args.include.participants).toBeDefined();
    expect(args.include.groupings).toBeDefined();
  });

  it("returns null for a session that does not exist", async () => {
    vi.mocked(prisma.session.findUnique).mockResolvedValue(null as never);

    expect(await loadSessionSummary(SessionId)).toBeNull();
  });
});
