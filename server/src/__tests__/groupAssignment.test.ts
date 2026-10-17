import { describe, it, expect, vi, beforeEach } from "vitest";
import type { InteractionPattern, RoutineConfig } from "ame-shared";
import prisma from "../prisma.js";
import { assignInteractionGroup } from "../socket/groupAssignment.js";
import { sessionMembersOf, type SessionInfoResult } from "../socket/sessionLookup.js";

vi.mock("../prisma.js", () => ({
  default: {
    experimentContent: { findMany: vi.fn() },
    sessionParticipant: { findFirst: vi.fn() },
    sessionGrouping: { upsert: vi.fn() },
  },
}));

const Seats = 4;

const sessionInfo = (seat: number, dropped: number[] = []): SessionInfoResult => ({
  seat,
  slotName: `S${seat}`,
  session: {
    id: "sess-1",
    routineName: "match",
    matchProgress: 0,
    sharedProgressSequence: null,
    participants: Array.from({ length: Seats }, (_, s) => ({
      participantId: `p${s}`,
      seat: s,
      slotName: `S${s}`,
      condition: "Basic",
      status: dropped.includes(s) ? ("DROPPED" as const) : ("ACTIVE" as const),
    })),
  },
});

const routine = (pattern?: InteractionPattern): RoutineConfig => ({
  name: "chat", type: "routine-card", layout: { rows: [] }, elements: [],
  ...(pattern ? { interactionPattern: pattern } : {}),
});

const input = (over: Partial<Parameters<typeof assignInteractionGroup>[0]>) => ({
  sessionInfo: null, routine: routine(), routines: [], experimentId: "exp-1",
  participantId: "p0", virtualProgress: 3, trialNumber: 1, ...over,
});

const member = (s: number) => ({ participantId: `p${s}`, seat: s, slotName: `S${s}` });

beforeEach(() => {
  vi.mocked(prisma.experimentContent.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue(null as never);
});

describe("assignInteractionGroup", () => {
  it("is null for a participant who never held a seat", async () => {
    expect(await assignInteractionGroup(input({}))).toBeNull();
  });

  it("gives an orphan whose seat dropped an explicitly empty group", async () => {
    vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue({ seat: 1 } as never);
    expect(await assignInteractionGroup(input({ participantId: "p1" }))).toEqual({
      interactionGroup: { peers: [], seat: 1, groupIndex: 0, partnerUnavailable: true, members: [] },
      provenance: null,
    });
  });

  it("without a pattern, groups every active member, self included, by seat", async () => {
    expect(await assignInteractionGroup(input({ sessionInfo: sessionInfo(0, [3]) }))).toEqual({
      interactionGroup: {
        peers: ["p1", "p2"], seat: 0, groupIndex: 0, partnerUnavailable: false,
        members: [member(0), member(1), member(2)],
      },
      provenance: null,
    });
  });

  it("with a fixed pattern, returns this seat's group and its provenance", async () => {
    const result = await assignInteractionGroup(input({
      sessionInfo: sessionInfo(2), participantId: "p2",
      routine: routine({ type: "fixed", groups: [[0, 1], [2, 3]] }),
    }));
    expect(result).toEqual({
      interactionGroup: { peers: ["p3"], seat: 2, groupIndex: 1, partnerUnavailable: false, members: [member(2), member(3)] },
      provenance: { patternType: "fixed", groupPeers: [2, 3], seatCount: 4, groupIndex: 1, seats: [2, 3], participantIds: ["p2", "p3"] },
    });
  });

  it("marks a seat whose scheduled partner dropped as unavailable and keeps only self", async () => {
    const result = await assignInteractionGroup(input({
      sessionInfo: sessionInfo(2, [3]), participantId: "p2",
      routine: routine({ type: "fixed", groups: [[0, 1], [2, 3]] }),
    }));
    expect(result?.interactionGroup).toEqual({
      peers: [], seat: 2, groupIndex: 1, partnerUnavailable: true, members: [member(2)],
    });
  });

  it("does not write the grouping row (side effects stay with deliverContent)", async () => {
    await assignInteractionGroup(input({
      sessionInfo: sessionInfo(2), participantId: "p2",
      routine: routine({ type: "fixed", groups: [[0, 1], [2, 3]] }),
    }));
    expect(prisma.sessionGrouping.upsert).not.toHaveBeenCalled();
  });
});

describe("sessionMembersOf", () => {
  it("lists the whole cohort by seat, dropped seats included", () => {
    const info = sessionInfo(0, [1]);
    info.session.participants.reverse();
    expect(sessionMembersOf(info)).toEqual([member(0), member(1), member(2), member(3)]);
  });
});
