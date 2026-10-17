import { describe, it, expect, beforeAll, vi } from "vitest";
import { computeRoundRobinRotations } from "ame-shared/interactionGroups";
import type { ContentPayload, MatchedPayload, RoutineConfig } from "ame-shared";

vi.mock("../prisma.js", async () => {
  const { fakePrisma } = await import("./helpers/fakePrisma.js");
  return { default: fakePrisma };
});

import { fakeDb, resetFakeDb } from "./helpers/fakePrisma.js";
import { createFakeNamespace, type FakeSocket } from "./helpers/socketHarness.js";
import { registerExperimentHandler } from "../socket/experimentHandler.js";
import { registerMatchingHandler } from "../socket/matchingHandler.js";
import { registerProgressHandler } from "../socket/progressHandler.js";
import { ReconnectGraceMs } from "../socket/sessionDropout.js";
import { MemoryWaitingRoomStore } from "../socket/waitingRoomStore.js";

const ExperimentId = "exp-rotation";
/**
 * Deliberately NOT "Basic". That is `DefaultCondition` in sessionCondition.ts,
 * so a cohort on "Basic" cannot tell `resolveSessionCondition` resolving the
 * lowest seat's anchor apart from it falling through to its own fallback — and
 * the condition-anchoring fix (B9) would go untested. On "Alpha" a broken
 * anchor reads "Basic", the rotation-band content query returns nothing, and
 * every rotation collapses to index 0.
 */
const Condition = "Alpha";
const CohortSize = 8;
const GroupSize = 2;
/** A full round-robin over N seats needs N-1 rotations to cover every pair. */
const TrialCount = CohortSize - 1;
/** Progress carrying the routine-matching row; the session stores it as matchProgress. */
const MatchProgress = 1;
const FirstTrialProgress = MatchProgress + 1;
/** Distinct unordered pairs over 8 seats: 8 * 7 / 2. */
const ExpectedPairCount = (CohortSize * (CohortSize - 1)) / 2;
/** Each pair is reported once from each side, so it shows up twice across the run. */
const ReportsPerPair = 2;
/** One SessionGrouping row per group per trial: 4 dyads over 7 trials. */
const ExpectedGroupingCount = TrialCount * (CohortSize / GroupSize);
const MatchRoutineName = "chat-match";
const TrialRoutineName = "chat";
const EndMatchRoutineName = "chat-end-match";
/** The seat whose socket is dropped in the dropout scenario. */
const DroppedSeat = 6;
/** The rotation observed after the drop: trial 2, i.e. rotation index 1. */
const DropoutRotation = 1;
/**
 * Bounded microtask drain. An unbounded spin over awaited mocks can never time
 * out — a vitest timeout is a TIMER, and a starved microtask queue never lets
 * one fire — so it would hang the whole suite instead of failing.
 */
const MaxFlushRounds = 100;

const Rotations = computeRoundRobinRotations(CohortSize, GroupSize);

/** Drain pending microtasks until `settled` holds, or give up after a fixed budget. */
const flushUntil = async (settled: () => boolean): Promise<void> => {
  for (let round = 0; round < MaxFlushRounds; round++) {
    if (settled()) return;
    await Promise.resolve();
  }
};

// ── Fixture ──────────────────────────────────────────

function buildRoutines(): RoutineConfig[] {
  return [
    {
      name: MatchRoutineName,
      type: "routine-matching",
      layout: { rows: [] },
      elements: [],
      matching: {
        strategy: "fifo",
        slots: Array.from({ length: CohortSize }, (_, i) => ({
          name: `seat-${i + 1}`,
          filters: [],
        })),
        // 0 disables the matching timeout, so this suite arms no stray timers.
        timeout: 0,
        timeoutAction: "wait",
      },
    },
    {
      name: TrialRoutineName,
      type: "routine-video-chat",
      layout: { rows: [] },
      elements: [],
      matching: null,
      interactionPattern: { type: "round-robin", groupSize: GroupSize },
    },
    {
      name: EndMatchRoutineName,
      type: "routine-end-matching",
      layout: { rows: [] },
      elements: [],
      matching: null,
    },
  ];
}

function seedExperiment(): void {
  resetFakeDb();
  fakeDb.experiments.push({
    id: ExperimentId,
    routines: buildRoutines(),
    randomization: false,
    randomizationConfig: null,
    conditions: [Condition],
    participantsPerSession: CohortSize,
  });
  fakeDb.content.push({
    id: "content-match",
    experimentId: ExperimentId,
    progress: MatchProgress,
    trialNumber: 1,
    routine: MatchRoutineName,
    content: {},
    condition: Condition,
    description: null,
  });
  for (let trial = 1; trial <= TrialCount; trial++) {
    fakeDb.content.push({
      id: `content-trial-${trial}`,
      experimentId: ExperimentId,
      progress: MatchProgress + trial,
      trialNumber: trial,
      routine: TrialRoutineName,
      content: {},
      condition: Condition,
      description: null,
    });
  }
  // Seeded for a realistic experiment shape only. Neither scenario proceeds
  // this far: closing the session is covered by the dropout suite instead.
  fakeDb.content.push({
    id: "content-end",
    experimentId: ExperimentId,
    progress: MatchProgress + TrialCount + 1,
    trialNumber: 1,
    routine: EndMatchRoutineName,
    content: {},
    condition: Condition,
    description: null,
  });
}

async function connectCohort(prefix: string): Promise<FakeSocket[]> {
  const store = new MemoryWaitingRoomStore();
  const ns = createFakeNamespace();
  const sockets: FakeSocket[] = [];

  for (let i = 0; i < CohortSize; i++) {
    const participantId = `${prefix}-p${i}`;
    fakeDb.participants.push({
      id: participantId,
      experimentId: ExperimentId,
      condition: Condition,
      progress: MatchProgress,
      currentStage: 0,
      role: 0,
      properties: {},
      completion: false,
      withdraw: false,
      isLoggedIn: true,
      lastLogTime: null,
      progressSequence: null,
    });
    const socket = ns.connect(`${prefix}-s${i}`);
    Object.assign(socket.data, {
      experimentId: ExperimentId,
      participantId,
      responseId: `${prefix}-r${i}`,
      condition: Condition,
      progress: MatchProgress,
    });
    // exp:join does this in production; the scenarios set socket.data directly,
    // so join the room by hand or the partner-withdrawn alert lands nowhere.
    socket.join(`experiment:${ExperimentId}:${participantId}`);

    // Registration order mirrors setupSocketHandlers. experimentHandler owns
    // the seat-drop listener, so leaving it out makes every dropout assertion
    // pass against a seat that never dropped.
    registerExperimentHandler(ns as never, socket as never, store);
    registerProgressHandler(ns as never, socket as never);
    registerMatchingHandler(ns as never, socket as never, store);
    sockets.push(socket);
  }

  // The runner renders the matching routine, then the routine emits match:join.
  for (const socket of sockets) {
    await socket.trigger("exp:ready");
    await socket.trigger("match:join", { routineName: MatchRoutineName });
  }

  return sockets;
}

// ── Observation helpers ──────────────────────────────

const lastContent = (socket: FakeSocket): ContentPayload => {
  const entry = [...socket.received].reverse().find((e) => e.event === "exp:content");
  if (!entry) throw new Error(`Socket ${socket.id} never received exp:content`);
  return entry.payload as ContentPayload;
};

const contentCount = (socket: FakeSocket): number =>
  socket.received.filter((e) => e.event === "exp:content").length;

const alertTypes = (socket: FakeSocket): string[] =>
  socket.received
    .filter((e) => e.event === "exp:alert")
    .map((e) => (e.payload as { type?: string }).type ?? "");

const seatStatus = (seat: number): string => {
  const row = fakeDb.sessionParticipants.find((sp) => sp.seat === seat);
  if (!row) throw new Error(`No session participant row for seat ${seat}`);
  return row.status;
};

const expectedPeerSeats = (rotation: number, seat: number): number[] => {
  const group = Rotations[rotation].find((g) => g.includes(seat));
  if (!group) throw new Error(`Seat ${seat} has no group in rotation ${rotation}`);
  return group.filter((s) => s !== seat);
};

interface SeatIndex {
  participantToSeat: Map<string, number>;
  seatToSocket: Map<number, FakeSocket>;
}

function indexSeats(sockets: FakeSocket[]): SeatIndex {
  const participantToSeat = new Map<string, number>();
  const seatToSocket = new Map<number, FakeSocket>();
  for (const sp of fakeDb.sessionParticipants) {
    const socket = sockets.find((s) => s.data.participantId === sp.participantId);
    if (!socket) {
      throw new Error(`No socket for session participant ${sp.participantId}`);
    }
    participantToSeat.set(sp.participantId, sp.seat);
    seatToSocket.set(sp.seat, socket);
  }
  return { participantToSeat, seatToSocket };
}

const peerSeatsOf = (payload: ContentPayload, index: SeatIndex): number[] =>
  (payload.interactionGroup?.peers ?? []).map((pid) => {
    const seat = index.participantToSeat.get(pid);
    if (seat === undefined) {
      throw new Error(`Delivered peer ${pid} is not a member of the session`);
    }
    return seat;
  });

// ── Scenario 1: the clean seven-trial walk ───────────

interface RotationObservation {
  progressBySeat: Map<number, number>;
  peerSeatsBySeat: Map<number, number[]>;
}

interface WalkRun {
  sessionCount: number;
  seats: number[];
  sessionIds: string[];
  countsBeforeFinalProceed: number[];
  countsAfterFinalProceed: number[];
  observations: RotationObservation[];
  groupingCount: number;
  groupingSeats: number[][];
}

async function runFullRotation(): Promise<WalkRun> {
  seedExperiment();
  const sockets = await connectCohort("walk");
  const index = indexSeats(sockets);

  const sessionIds = sockets.map((socket) => {
    const entry = socket.received.find((e) => e.event === "match:matched");
    if (!entry) throw new Error(`Socket ${socket.id} was never matched`);
    return (entry.payload as MatchedPayload).sessionId;
  });

  const observations: RotationObservation[] = [];
  let countsBeforeFinalProceed: number[] = [];
  let countsAfterFinalProceed: number[] = [];

  for (let rotation = 0; rotation < TrialCount; rotation++) {
    for (const socket of sockets.slice(0, CohortSize - 1)) {
      await socket.trigger("exp:proceed");
    }
    if (rotation === 0) countsBeforeFinalProceed = sockets.map(contentCount);
    await sockets[CohortSize - 1].trigger("exp:proceed");
    if (rotation === 0) countsAfterFinalProceed = sockets.map(contentCount);

    const progressBySeat = new Map<number, number>();
    const peerSeatsBySeat = new Map<number, number[]>();
    for (const [seat, socket] of index.seatToSocket) {
      const payload = lastContent(socket);
      progressBySeat.set(seat, payload.progress);
      peerSeatsBySeat.set(seat, peerSeatsOf(payload, index));
    }
    observations.push({ progressBySeat, peerSeatsBySeat });
  }

  return {
    sessionCount: fakeDb.sessions.length,
    seats: fakeDb.sessionParticipants.map((sp) => sp.seat),
    sessionIds,
    countsBeforeFinalProceed,
    countsAfterFinalProceed,
    observations,
    groupingCount: fakeDb.sessionGroupings.length,
    groupingSeats: fakeDb.sessionGroupings.map((g) => g.seats),
  };
}

// ── Scenario 2: one participant drops mid-session ────

interface DropoutRun {
  orphanSeat: number;
  activeSeats: number[];
  statusDuringGrace: string;
  progressBySeat: Map<number, number>;
  peerSeatsBySeat: Map<number, number[]>;
  groupBySeat: Map<number, ContentPayload["interactionGroup"]>;
  alertsBySeat: Map<number, string[]>;
  leaverAlerts: string[];
  droppedStatus: string;
  cohortSeatCount: number;
  sessionStatus: string;
}

async function runDropout(): Promise<DropoutRun> {
  seedExperiment();
  const sockets = await connectCohort("drop");
  const index = indexSeats(sockets);

  // Advance the intact cohort into the first trial (rotation 0).
  for (const socket of sockets) await socket.trigger("exp:proceed");

  const droppedSocket = index.seatToSocket.get(DroppedSeat);
  if (!droppedSocket) throw new Error(`No socket occupies seat ${DroppedSeat}`);

  // The disconnect only ARMS the drop: experimentHandler schedules it behind
  // ReconnectGraceMs so a page refresh cannot orphan a seat. Fake timers are
  // mandatory here — under real timers nothing is ever marked DROPPED and every
  // assertion below would silently describe an intact cohort.
  let statusDuringGrace: string;
  vi.useFakeTimers();
  try {
    droppedSocket.disconnect();
    await droppedSocket.trigger("disconnect", "transport close");

    await vi.advanceTimersByTimeAsync(ReconnectGraceMs - 1);
    await flushUntil(() => seatStatus(DroppedSeat) === "DROPPED");
    statusDuringGrace = seatStatus(DroppedSeat);

    await vi.advanceTimersByTimeAsync(1);
    await flushUntil(() => seatStatus(DroppedSeat) === "DROPPED");
  } finally {
    vi.useRealTimers();
  }

  const remaining = sockets.filter((socket) => socket !== droppedSocket);
  for (const socket of remaining) await socket.trigger("exp:proceed");

  const orphanSeat = expectedPeerSeats(DropoutRotation, DroppedSeat)[0];

  const progressBySeat = new Map<number, number>();
  const peerSeatsBySeat = new Map<number, number[]>();
  const groupBySeat = new Map<number, ContentPayload["interactionGroup"]>();
  const alertsBySeat = new Map<number, string[]>();
  for (const [seat, socket] of index.seatToSocket) {
    if (seat === DroppedSeat) continue;
    const payload = lastContent(socket);
    progressBySeat.set(seat, payload.progress);
    peerSeatsBySeat.set(seat, peerSeatsOf(payload, index));
    groupBySeat.set(seat, payload.interactionGroup);
    alertsBySeat.set(seat, alertTypes(socket));
  }

  return {
    orphanSeat,
    activeSeats: [...index.seatToSocket.keys()]
      .filter((seat) => seat !== DroppedSeat)
      .sort((a, b) => a - b),
    statusDuringGrace,
    progressBySeat,
    peerSeatsBySeat,
    groupBySeat,
    alertsBySeat,
    leaverAlerts: alertTypes(droppedSocket),
    droppedStatus: seatStatus(DroppedSeat),
    cohortSeatCount: fakeDb.sessionParticipants.length,
    sessionStatus: fakeDb.sessions[0].status,
  };
}

// ── Suite ────────────────────────────────────────────

describe("Rotating video-chat session (8 participants, round-robin dyads)", () => {
  let walk: WalkRun;
  let dropout: DropoutRun;

  beforeAll(async () => {
    walk = await runFullRotation();
    dropout = await runDropout();
  });

  describe("cohort assembly", () => {
    it("forms exactly one session for eight joiners", () => {
      expect(walk.sessionCount).toBe(1);
    });

    it("assigns eight distinct seats", () => {
      expect(walk.seats).toHaveLength(CohortSize);
      expect([...new Set(walk.seats)].sort((a, b) => a - b)).toEqual(
        Array.from({ length: CohortSize }, (_, i) => i),
      );
    });

    it("gives every participant the same session id", () => {
      expect(new Set(walk.sessionIds).size).toBe(1);
    });
  });

  describe("session sync barrier", () => {
    it("delivers no new content until the last member proceeds", () => {
      // Each socket has exactly the one exp:content from exp:ready.
      expect(walk.countsBeforeFinalProceed).toEqual(Array(CohortSize).fill(1));
    });

    it("delivers to every member once the last member proceeds", () => {
      expect(walk.countsAfterFinalProceed).toEqual(Array(CohortSize).fill(2));
    });
  });

  describe("rotation schedule", () => {
    for (let rotation = 0; rotation < TrialCount; rotation++) {
      it(`pairs seats per rotation ${rotation} at progress ${FirstTrialProgress + rotation}`, () => {
        const observation = walk.observations[rotation];
        for (const [seat, peerSeats] of observation.peerSeatsBySeat) {
          expect(peerSeats).toEqual(expectedPeerSeats(rotation, seat));
        }
      });

      it(`advances every member to progress ${FirstTrialProgress + rotation}`, () => {
        const observation = walk.observations[rotation];
        for (const progress of observation.progressBySeat.values()) {
          expect(progress).toBe(FirstTrialProgress + rotation);
        }
      });
    }

    it("delivers symmetric groups", () => {
      for (const observation of walk.observations) {
        for (const [seat, peerSeats] of observation.peerSeatsBySeat) {
          for (const peer of peerSeats) {
            expect(observation.peerSeatsBySeat.get(peer)).toContain(seat);
          }
        }
      }
    });
  });

  describe("coverage", () => {
    const countPairs = (run: WalkRun): Map<string, number> => {
      const counts = new Map<string, number>();
      for (const observation of run.observations) {
        for (const [seat, peerSeats] of observation.peerSeatsBySeat) {
          for (const peer of peerSeats) {
            const key = [seat, peer].sort((a, b) => a - b).join("-");
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        }
      }
      return counts;
    };

    it("meets all 28 pairs across the seven trials", () => {
      expect(countPairs(walk).size).toBe(ExpectedPairCount);
    });

    it("meets each pair exactly once", () => {
      for (const [pair, count] of countPairs(walk)) {
        // Encoding the pair into the assertion names the offender on failure.
        expect(`${pair}:${count}`).toBe(`${pair}:${ReportsPerPair}`);
      }
    });

    it("persists one grouping row per rotation group, with plain array columns", () => {
      expect(walk.groupingCount).toBe(ExpectedGroupingCount);
      for (const seats of walk.groupingSeats) {
        // The fake stores the scalar list VERBATIM, so this asserts what
        // recordSessionGrouping wrote: a regression to Prisma's alternative
        // `{ set: [...] }` form fails both lines.
        expect(Array.isArray(seats)).toBe(true);
        expect(seats).toHaveLength(GroupSize);
      }
    });
  });

  describe("dropout tolerance", () => {
    it("holds the seat ACTIVE for the whole reconnect grace", () => {
      expect(dropout.statusDuringGrace).toBe("ACTIVE");
    });

    it("marks the dropped member DROPPED once the grace elapses", () => {
      expect(dropout.droppedStatus).toBe("DROPPED");
    });

    it("keeps the cohort at its match-time seat count", () => {
      // seatCount drives the rotation table; a DROPPED seat must stay in it.
      expect(dropout.cohortSeatCount).toBe(CohortSize);
    });

    it("advances the remaining seven past the shrunken barrier", () => {
      expect(dropout.progressBySeat.size).toBe(CohortSize - 1);
      for (const progress of dropout.progressBySeat.values()) {
        expect(progress).toBe(FirstTrialProgress + DropoutRotation);
      }
    });

    it("leaves the orphan with an explicitly empty group", () => {
      // Asserting the whole group, not just the peer list: an ABSENT
      // interactionGroup also yields [] from peerSeatsOf, so peers alone cannot
      // tell "delivered a solo group" from "delivered nothing at all".
      expect(dropout.peerSeatsBySeat.get(dropout.orphanSeat)).toEqual([]);
      expect(dropout.groupBySeat.get(dropout.orphanSeat)).toEqual({
        peers: [],
        seat: dropout.orphanSeat,
        groupIndex: expect.any(Number),
        partnerUnavailable: true,
        // The orphan is still seated, so its group holds only itself.
        members: [expect.objectContaining({ seat: dropout.orphanSeat })],
      });
    });

    it("signals partner-unavailable to the orphan only", () => {
      for (const seat of dropout.activeSeats) {
        const unavailable = dropout.groupBySeat.get(seat)?.partnerUnavailable ?? false;
        expect(`seat ${seat}: ${unavailable}`).toBe(
          `seat ${seat}: ${seat === dropout.orphanSeat}`,
        );
      }
    });

    it("keeps the original eight-seat schedule for everyone else", () => {
      for (const seat of dropout.activeSeats) {
        if (seat === dropout.orphanSeat) continue;
        expect(dropout.peerSeatsBySeat.get(seat)).toEqual(
          expectedPeerSeats(DropoutRotation, seat),
        );
      }
    });

    it("alerts every surviving member and not the leaver", () => {
      for (const seat of dropout.activeSeats) {
        expect(dropout.alertsBySeat.get(seat)).toContain("partner-withdrawn");
      }
      expect(dropout.leaverAlerts).not.toContain("partner-withdrawn");
    });

    it("keeps the session ACTIVE", () => {
      expect(dropout.sessionStatus).toBe("ACTIVE");
    });
  });
});
