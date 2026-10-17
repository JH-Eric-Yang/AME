import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import adminRoutes from "../routes/admin.js";
import prisma from "../prisma.js";
import { signToken } from "../middleware/auth.js";
import { useTestServer } from "./helpers/httpTestServer.js";
import { deliverContent } from "../socket/progressHandler.js";
import {
  indexGroupingsByParticipant,
  collectGroupedParticipantIds,
  groupingKey,
} from "../sessionGrouping.js";

vi.mock("../prisma.js", () => ({
  default: {
    experiment: { findUnique: vi.fn(), findFirst: vi.fn() },
    participant: { findUnique: vi.fn(), findMany: vi.fn() },
    experimentContent: { findFirst: vi.fn(), findMany: vi.fn() },
    experimentResult: { findMany: vi.fn() },
    session: { update: vi.fn() },
    sessionParticipant: { findFirst: vi.fn(), findMany: vi.fn() },
    sessionGrouping: { upsert: vi.fn(), findMany: vi.fn() },
  },
}));

// app.ts opens a listening HTTP server at import time; admin.ts imports `io`
// from it, so it is stubbed exactly as in admin.test.ts.
vi.mock("../app.js", () => ({
  io: { of: () => ({ sockets: new Map() }) },
}));

const ExperimentId = "exp-rot-1";
const SessionId = "sess-rot-1";
const ChatProgress = 3;
const ChatTrialNumber = 2;
const MatchProgress = 1;
const CohortCondition = "Basic";

const RotationExperiment = {
  id: ExperimentId,
  name: "Rotation",
  randomization: false,
  routines: [
    {
      name: "chat",
      type: "routine-video-chat",
      interactionPattern: { type: "round-robin", groupSize: 2 },
      elements: [],
    },
  ],
};

const ChatContent = {
  id: "content-1",
  experimentId: ExperimentId,
  progress: ChatProgress,
  trialNumber: ChatTrialNumber,
  routine: "chat",
  content: {},
  condition: CohortCondition,
  description: null,
};

type Member = { participantId: string; seat: number };

/** The raw Prisma row shape findActiveSession selects for a nested seat. */
function seatRow(member: Member) {
  return {
    participantId: member.participantId,
    seat: member.seat,
    status: "ACTIVE" as const,
    participant: { condition: CohortCondition },
  };
}

function sessionParticipantFor(member: Member, cohort: Member[]) {
  return {
    id: `sp-${member.participantId}`,
    sessionId: SessionId,
    participantId: member.participantId,
    seat: member.seat,
    slotName: null,
    status: "ACTIVE",
    session: {
      id: SessionId,
      matchProgress: MatchProgress,
      sharedProgressSequence: null,
      participants: cohort.map(seatRow),
    },
  };
}

function createMockSocket(id = "socket-1") {
  return {
    id,
    data: {} as Record<string, unknown>,
    emit: vi.fn(),
    join: vi.fn(),
    to: vi.fn(() => ({ emit: vi.fn() })),
  };
}

function createMockNamespace() {
  return {
    to: vi.fn(() => ({ emit: vi.fn() })),
    fetchSockets: vi.fn(async () => []),
  };
}

function stateFor(member: Member) {
  return {
    experimentId: ExperimentId,
    participantId: member.participantId,
    responseId: `resp-${member.participantId}`,
    progress: ChatProgress,
    condition: CohortCondition,
  };
}

/** Mocks common to every deliverContent test: experiment, content, participant. */
function mockContentDelivery(): void {
  vi.mocked(prisma.experiment.findUnique).mockResolvedValue(RotationExperiment as never);
  vi.mocked(prisma.experimentContent.findFirst).mockResolvedValue(ChatContent as never);
  vi.mocked(prisma.experimentContent.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.participant.findUnique).mockResolvedValue({
    role: 0,
    properties: {},
  } as never);
  vi.mocked(prisma.sessionGrouping.upsert).mockResolvedValue({} as never);
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SessionGrouping persistence", () => {
  it("converges both members of a dyad on one row per (session, progress, groupIndex)", async () => {
    const cohort: Member[] = [
      { participantId: "p-a", seat: 0 },
      { participantId: "p-b", seat: 1 },
    ];
    mockContentDelivery();
    vi.mocked(prisma.sessionParticipant.findFirst)
      .mockResolvedValueOnce(sessionParticipantFor(cohort[0], cohort) as never)
      .mockResolvedValueOnce(sessionParticipantFor(cohort[1], cohort) as never);

    const ns = createMockNamespace();
    for (const member of cohort) {
      await deliverContent(
        ns as never,
        createMockSocket(member.participantId) as never,
        stateFor(member) as never,
      );
    }

    const calls = vi.mocked(prisma.sessionGrouping.upsert).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0].where).toEqual(calls[1][0].where);
    expect(calls[0][0].where).toEqual({
      sessionId_progress_groupIndex: {
        sessionId: SessionId,
        progress: ChatProgress,
        groupIndex: 0,
      },
    });
    expect(calls[0][0].create).toEqual(calls[1][0].create);
    expect(calls[0][0].create).toEqual({
      sessionId: SessionId,
      progress: ChatProgress,
      groupIndex: 0,
      trialNumber: ChatTrialNumber,
      routineName: "chat",
      seats: [0, 1],
      participantIds: ["p-a", "p-b"],
    });
    // Plain arrays, not { set: [...] }: the update payload must read back the
    // same way from a real client and from an in-memory fake that merges it.
    expect(calls[0][0].update).toEqual({
      trialNumber: ChatTrialNumber,
      routineName: "chat",
      seats: [0, 1],
      participantIds: ["p-a", "p-b"],
    });
  });

  it("warns when round-robin leaves a seat alone in a multi-seat cohort", async () => {
    // Three seats numbered 0, 1 and 3. Seat numbers are fixed at match time and
    // a hand-imported or repaired session can carry a gap, so the rotation
    // table is built for three seats and holds no group containing seat 3 —
    // that participant silently ends up alone today.
    // This is NOT the dropout case: a DROPPED seat still counts toward
    // seatCount, so a dropout never shrinks the rotation table.
    const cohort: Member[] = [
      { participantId: "p-a", seat: 0 },
      { participantId: "p-b", seat: 1 },
      { participantId: "p-d", seat: 3 },
    ];
    mockContentDelivery();
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue(
      sessionParticipantFor(cohort[2], cohort) as never,
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await deliverContent(
      createMockNamespace() as never,
      createMockSocket("p-d") as never,
      stateFor(cohort[2]) as never,
    );

    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0][0] as string;
    expect(message).toContain("Round-robin left seat 3 alone in a cohort of 3");
    expect(message).toContain(`session ${SessionId}`);
    expect(message).toContain(`progress ${ChatProgress}`);
  });

  it("still delivers content when the grouping write fails", async () => {
    const cohort: Member[] = [
      { participantId: "p-a", seat: 0 },
      { participantId: "p-b", seat: 1 },
    ];
    mockContentDelivery();
    vi.mocked(prisma.sessionGrouping.upsert).mockRejectedValue(new Error("connection terminated"));
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue(
      sessionParticipantFor(cohort[0], cohort) as never,
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const socket = createMockSocket("p-a");

    await deliverContent(
      createMockNamespace() as never,
      socket as never,
      stateFor(cohort[0]) as never,
    );

    expect(socket.emit).toHaveBeenCalledWith(
      "exp:content",
      expect.objectContaining({ progress: ChatProgress }),
    );
    expect(socket.emit).not.toHaveBeenCalledWith("error", expect.anything());
    expect(errorSpy.mock.calls[0][0]).toContain(
      `Failed to persist grouping for session ${SessionId}`,
    );
  });
});

describe("indexGroupingsByParticipant", () => {
  const Grouping = {
    sessionId: "s1",
    progress: 5,
    groupIndex: 1,
    seats: [2, 4, 6],
    participantIds: ["p2", "p4", "p6"],
  };
  const ResponseIds = new Map([
    ["p2", "resp-2"],
    ["p4", "resp-4"],
    ["p6", "resp-6"],
  ]);

  it("maps each member to its seat, group index and semicolon-joined partners", () => {
    const index = indexGroupingsByParticipant([Grouping], ResponseIds);

    // Keyed by participant id (what an ExperimentResult row carries) but the
    // partners are responseIds (what the export identifies rows by).
    expect(index.get(groupingKey("p4", 5))).toEqual({
      sessionId: "s1",
      seat: 4,
      groupIndex: 1,
      partners: "resp-2;resp-6",
    });
    expect(index.get(groupingKey("p2", 5))).toEqual({
      sessionId: "s1",
      seat: 2,
      groupIndex: 1,
      partners: "resp-4;resp-6",
    });
    expect(index.get(groupingKey("p4", 6))).toBeUndefined();
  });

  it("omits a partner whose participant row no longer resolves to a responseId", () => {
    const index = indexGroupingsByParticipant(
      [Grouping],
      new Map([
        ["p2", "resp-2"],
        ["p4", "resp-4"],
      ]),
    );

    // Never the raw uuid: every value in the column must be a real responseId.
    expect(index.get(groupingKey("p4", 5))?.partners).toBe("resp-2");
  });

  it("collects the deduplicated participant ids to resolve", () => {
    expect(
      collectGroupedParticipantIds([Grouping, { ...Grouping, progress: 6 }]),
    ).toEqual(["p2", "p4", "p6"]);
  });
});

describe("GET /api/admin/experiments/:id/export/csv", () => {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRoutes);

  // One listening server for this describe; see the helper for why
  // supertest must never be handed the bare app.
  const server = useTestServer(app);

  const AuthHeader = `Bearer ${signToken({
    experimenterId: "experimenter-1",
    email: "test@example.com",
    role: "EXPERIMENTER",
  })}`;

  it("adds sessionId, seat, groupIndex and partners columns", async () => {
    vi.mocked(prisma.experiment.findFirst).mockResolvedValue({
      id: ExperimentId,
      name: "Rotation",
    } as never);
    vi.mocked(prisma.experimentResult.findMany).mockResolvedValue([
      {
        id: "r1",
        experimentId: ExperimentId,
        participantId: "p-a",
        responseId: "resp-a",
        progress: ChatProgress,
        trial: ChatTrialNumber,
        routine: "chat",
        response: { q1: "yes" },
        trialInfo: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        participant: { externalId: "PID-A" },
      },
      {
        id: "r2",
        experimentId: ExperimentId,
        participantId: "p-b",
        responseId: "resp-b",
        progress: ChatProgress,
        trial: ChatTrialNumber,
        routine: "chat",
        response: { q1: "maybe" },
        trialInfo: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        participant: { externalId: "PID-B" },
      },
      {
        id: "r3",
        experimentId: ExperimentId,
        participantId: "p-solo",
        responseId: "resp-solo",
        progress: 9,
        trial: 1,
        routine: "survey",
        response: { q1: "no" },
        trialInfo: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        participant: { externalId: null },
      },
    ] as never);
    vi.mocked(prisma.sessionGrouping.findMany).mockResolvedValue([
      {
        sessionId: SessionId,
        progress: ChatProgress,
        groupIndex: 0,
        seats: [0, 1, 2],
        participantIds: ["p-a", "p-b", "p-c"],
      },
    ] as never);
    // Participant.id and Participant.responseId are independent uuids, so the
    // export must translate one into the other to stay joinable.
    vi.mocked(prisma.participant.findMany).mockResolvedValue([
      { id: "p-a", responseId: "resp-a" },
      { id: "p-b", responseId: "resp-b" },
      { id: "p-c", responseId: "resp-c" },
    ] as never);

    const res = await request(server)
      .get(`/api/admin/experiments/${ExperimentId}/export/csv`)
      .set("Authorization", AuthHeader);

    expect(res.status).toBe(200);
    // Groupings must be scoped to this experiment, or the CSV leaks other
    // experiments' sessions into every row.
    expect(prisma.sessionGrouping.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { session: { experimentId: ExperimentId } } }),
    );

    const [header, matched, partnerRow, unmatched] = res.text.split("\n");
    const columns = header.split(",");
    expect(columns).toEqual([
      "responseId",
      "externalId",
      "progress",
      "trial",
      "routine",
      "sessionId",
      "seat",
      "groupIndex",
      "partners",
      "q1",
      "createdAt",
    ]);
    expect(matched).toBe(
      `resp-a,PID-A,3,2,chat,${SessionId},0,0,resp-b;resp-c,yes,2026-01-01T00:00:00.000Z`,
    );
    expect(partnerRow).toBe(
      `resp-b,PID-B,3,2,chat,${SessionId},1,0,resp-a;resp-c,maybe,2026-01-01T00:00:00.000Z`,
    );
    expect(unmatched).toBe('resp-solo,,9,1,survey,,,,,no,2026-01-01T00:00:00.000Z');

    // The point of the column: a partner id must be joinable against another
    // row of this same export. Internal Participant.id values would appear
    // nowhere else in the file and could not be resolved by an analyst.
    const partnersColumn = columns.indexOf("partners");
    const responseIdColumn = columns.indexOf("responseId");
    const partnersOfA = matched.split(",")[partnersColumn].split(";");
    expect(partnersOfA).toContain(partnerRow.split(",")[responseIdColumn]);
    // ...and the join is symmetric: p-b names p-a right back.
    expect(partnerRow.split(",")[partnersColumn].split(";")).toContain(
      matched.split(",")[responseIdColumn],
    );
  });
});
