import { describe, it, expect, vi, afterEach } from "vitest";
import prisma from "../prisma.js";
import { deliverContent } from "../socket/progressHandler.js";
import type { SocketState } from "../socket/index.js";

vi.mock("../prisma.js", () => ({
  default: {
    experiment: { findUnique: vi.fn() },
    participant: { findUnique: vi.fn() },
    experimentContent: { findFirst: vi.fn(), findMany: vi.fn() },
    sessionParticipant: { findFirst: vi.fn() },
    sessionGrouping: { upsert: vi.fn() },
  },
}));

const ExperimentId = "exp-rotation";
const SessionId = "sess-rotation";
const MatchProgress = 1;
const DeliveredProgress = 3;

/** seat → { participantId, condition }; conditions deliberately alternate. */
const Seats = [
  { participantId: "p-0", seat: 0, condition: "Speech" },
  { participantId: "p-1", seat: 1, condition: "Gesture" },
  { participantId: "p-2", seat: 2, condition: "Speech" },
  { participantId: "p-3", seat: 3, condition: "Gesture" },
];

const experiment = {
  id: ExperimentId,
  randomization: false,
  routines: [
    {
      name: "chat",
      type: "routine-video-chat",
      elements: [],
      interactionPattern: { type: "round-robin", groupSize: 2 },
    },
    { name: "rest", type: "routine-card", elements: [] },
  ],
};

/**
 * Progress 2 is a round-robin `chat` for Speech and a plain `rest` for
 * Gesture, so a condition-scoped rotation index differs per member.
 */
const contentRows = [
  { progress: 2, routine: "chat", condition: "Speech" },
  { progress: 2, routine: "rest", condition: "Gesture" },
  { progress: 3, routine: "chat", condition: "Speech" },
  { progress: 3, routine: "chat", condition: "Gesture" },
];

interface DeliveredGroup {
  peers: string[];
  seat: number;
  groupIndex: number;
  partnerUnavailable?: boolean;
}

function createRecordingSocket() {
  const emitted: Array<{ event: string; payload: unknown }> = [];
  return {
    emitted,
    emit: (event: string, payload: unknown) => {
      emitted.push({ event, payload });
    },
  };
}

async function deliverTo(participantId: string): Promise<DeliveredGroup | undefined> {
  const self = Seats.find((s) => s.participantId === participantId)!;
  const socket = createRecordingSocket();
  const state: SocketState = {
    experimentId: ExperimentId,
    participantId,
    progress: DeliveredProgress,
    condition: self.condition,
  } as SocketState;

  await deliverContent({} as never, socket as never, state);

  const content = socket.emitted.find((e) => e.event === "exp:content");
  expect(content, `no exp:content emitted for ${participantId}`).toBeDefined();
  return (content!.payload as { interactionGroup?: DeliveredGroup })
    .interactionGroup;
}

function queriedConditions(): string[] {
  return vi
    .mocked(prisma.experimentContent.findMany)
    .mock.calls.map(
      (call) => (call[0] as { where: { condition: string } }).where.condition,
    );
}

describe("rotation index is session-scoped, not condition-scoped", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** @param droppedSeats seats whose SessionParticipant row reads DROPPED. */
  function stubPrisma(droppedSeats: number[] = []) {
    vi.mocked(prisma.experiment.findUnique).mockResolvedValue(
      experiment as never,
    );
    vi.mocked(prisma.participant.findUnique).mockImplementation((async (args: {
      where: { id: string };
    }) => ({ id: args.where.id, role: 0, properties: {} })) as never);

    vi.mocked(prisma.experimentContent.findFirst).mockImplementation((async (args: {
      where: { progress: number; condition: string };
    }) => {
      const row = contentRows.find(
        (r) =>
          r.progress === args.where.progress &&
          r.condition === args.where.condition,
      );
      return row ? { ...row, trialNumber: 1, content: {} } : null;
    }) as never);

    // The rotation-band query: rows strictly between matchProgress and now.
    vi.mocked(prisma.experimentContent.findMany).mockImplementation((async (args: {
      where: { condition: string; progress: { gt: number; lt: number } };
    }) =>
      contentRows.filter(
        (r) =>
          r.condition === args.where.condition &&
          r.progress > args.where.progress.gt &&
          r.progress < args.where.progress.lt,
      )) as never);

    // The FULL cohort is always returned, dropped seats included — that is the
    // contract findActiveSession must honour.
    vi.mocked(prisma.sessionParticipant.findFirst).mockImplementation((async (args: {
      where: { participantId: string };
    }) => {
      const self = Seats.find(
        (s) => s.participantId === args.where.participantId,
      )!;
      return {
        seat: self.seat,
        slotName: null,
        session: {
          id: SessionId,
          matchProgress: MatchProgress,
          sharedProgressSequence: null,
          participants: Seats.map((s) => ({
            participantId: s.participantId,
            seat: s.seat,
            status: droppedSeats.includes(s.seat) ? "DROPPED" : "ACTIVE",
            participant: { condition: s.condition },
          })),
        },
      };
    }) as never);
  }

  it("pairs two members of one session symmetrically across conditions", async () => {
    stubPrisma();

    const speechGroup = await deliverTo("p-0"); // seat 0, condition Speech
    const gestureGroup = await deliverTo("p-1"); // seat 1, condition Gesture

    expect(speechGroup?.peers).toEqual(["p-1"]);
    expect(gestureGroup?.peers).toEqual(["p-0"]);
    expect(gestureGroup?.groupIndex).toBe(speechGroup?.groupIndex);
  });

  it("gives every seat a partner that names it back", async () => {
    stubPrisma();

    const groups = new Map<string, string[]>();
    for (const { participantId } of Seats) {
      const group = await deliverTo(participantId);
      groups.set(participantId, group?.peers ?? []);
    }

    for (const [participantId, peers] of groups) {
      for (const peer of peers) {
        expect(
          groups.get(peer),
          `${peer} does not list ${participantId} back`,
        ).toContain(participantId);
      }
    }
  });

  it("queries the rotation band with one condition for every member", async () => {
    stubPrisma();

    await deliverTo("p-0");
    await deliverTo("p-1");

    expect(queriedConditions()).toHaveLength(2);
    expect(new Set(queriedConditions()).size).toBe(1);
  });

  it("keeps the anchor on the lowest seat's condition after that seat drops", async () => {
    // Seat 0 (Speech) has withdrawn. If the anchor were computed from ACTIVE
    // seats only it would move to seat 1 (Gesture) and every surviving member
    // would jump to a different rotation mid-session.
    stubPrisma([0]);

    await deliverTo("p-1");
    await deliverTo("p-2");

    expect(queriedConditions()).toEqual(["Speech", "Speech"]);
  });

  it("keeps seatCount at the full cohort after a seat drops", async () => {
    // A 3-seat count is not divisible by groupSize 2, so
    // computeRoundRobinRotations collapses to one all-seats group (B8) and
    // these pairings would change: seat 1 would be offered seat 2, and seat 2
    // seat 1, instead of the schedule below.
    stubPrisma([0]);

    const seatOne = await deliverTo("p-1");
    const seatTwo = await deliverTo("p-2");

    // Seat 1 is still scheduled against the empty seat 0, so it sits this
    // rotation out — a DROPPED seat is never advertised as a WebRTC peer.
    expect(seatOne?.peers).toEqual([]);
    expect(seatOne?.partnerUnavailable).toBe(true);
    // Seat 2 keeps its live partner at seat 3, which is what pins the schedule.
    expect(seatTwo?.peers).toEqual(["p-3"]);
    expect(seatTwo?.partnerUnavailable).toBe(false);
  });

  it("never filters the nested participants include", async () => {
    stubPrisma([0]);
    await deliverTo("p-1");

    const call = vi.mocked(prisma.sessionParticipant.findFirst).mock
      .calls[0][0] as {
      include: { session: { include: { participants: { where?: unknown } } } };
    };
    // A `where` here shrinks seatCount after a dropout and silently collapses
    // the rotation schedule to one all-seats group (B8). Every other test in
    // this file stubs the full cohort regardless of `include`, so this is the
    // only assertion that catches the filter being added.
    expect(call.include.session.include.participants.where).toBeUndefined();
  });

  describe("the orphan notice", () => {
    /**
     * No ACTIVE seat, but a DROPPED row proving one was held. The experiment
     * deliberately leaves `participantsPerSession` at its default of 1: cohort
     * size at runtime is `matching.slots.length`, and the slot editor never
     * writes `participantsPerSession`, so a Builder-authored rotation would be
     * skipped entirely if the branch were gated on it.
     */
    function stubOrphan() {
      stubPrisma();
      vi.mocked(prisma.sessionParticipant.findFirst).mockImplementation((async (args: {
        where: { status: string };
      }) => (args.where.status === "DROPPED" ? { seat: 2 } : null)) as never);
    }

    it("sends an empty group so the client drops its stale partner", async () => {
      expect(
        (experiment as { participantsPerSession?: number }).participantsPerSession,
      ).toBeUndefined();
      stubOrphan();

      const group = await deliverTo("p-2");

      // Without an explicit group the client's
      // `payload.interactionGroup ?? s.interactionGroup` keeps the old one and
      // the orphan goes on dialling a partner who closed their tab.
      expect(group).toEqual({
        peers: [],
        seat: 2,
        groupIndex: 0,
        partnerUnavailable: true,
        members: [],
      });
    });

    it("sends no group for a participant who never held a seat", async () => {
      stubPrisma();
      vi.mocked(prisma.sessionParticipant.findFirst).mockResolvedValue(
        null as never,
      );

      expect(await deliverTo("p-2")).toBeUndefined();
    });
  });
});
