import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import prisma from "../prisma.js";
import {
  ReconnectGraceMs,
  cancelSeatDrop,
  dropSeatsForParticipant,
  scheduleSeatDrop,
} from "../socket/sessionDropout.js";
import { setErrorSink, consoleSink, type ErrorRecord } from "../errors/reportError.js";

vi.mock("../prisma.js", () => ({
  default: {
    experiment: { findUnique: vi.fn() },
    participant: { findUnique: vi.fn(), update: vi.fn() },
    experimentContent: { findFirst: vi.fn(), findMany: vi.fn() },
    sessionParticipant: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    session: { update: vi.fn() },
  },
}));

const ExperimentId = "exp-1";
const SessionId = "sess-1";
const CohortSize = 8;
const LeaverId = "p7";

/** The row `dropSeatsForParticipant` reads for `participantId`, with the whole cohort attached. */
function makeMembership(participantId: string, alreadyDropped: string[] = []) {
  return {
    id: `sp-${participantId}`,
    sessionId: SessionId,
    participantId,
    seat: Number(participantId.slice(1)),
    status: "ACTIVE",
    session: {
      id: SessionId,
      status: "ACTIVE",
      participants: Array.from({ length: CohortSize }, (_, seat) => ({
        participantId: `p${seat}`,
        seat,
        status: alreadyDropped.includes(`p${seat}`) ? "DROPPED" : "ACTIVE",
      })),
    },
  };
}

function makeNamespace() {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  return { ns: { to, fetchSockets: vi.fn(async () => []) }, to, emit };
}

describe("sessionDropout", () => {
  beforeEach(() => {
    vi.mocked(prisma.sessionParticipant.update).mockResolvedValue({} as never);
    vi.mocked(prisma.session.update).mockResolvedValue({} as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("dropSeatsForParticipant", () => {
    it("marks the leaver's seat DROPPED with a timestamp", async () => {
      const { ns } = makeNamespace();
      vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([
        makeMembership(LeaverId),
      ] as never);

      await dropSeatsForParticipant(ns as never, ExperimentId, LeaverId);

      expect(prisma.sessionParticipant.update).toHaveBeenCalledWith({
        where: { id: `sp-${LeaverId}` },
        data: { status: "DROPPED", droppedAt: expect.any(Date) },
      });
    });

    it("keeps the session ACTIVE while seven seats remain", async () => {
      const { ns } = makeNamespace();
      vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([
        makeMembership(LeaverId),
      ] as never);

      const result = await dropSeatsForParticipant(ns as never, ExperimentId, LeaverId);

      expect(prisma.session.update).not.toHaveBeenCalled();
      expect(result).toEqual({ droppedSessionIds: [SessionId], closedSessionIds: [] });
    });

    it("alerts the seven remaining members and not the leaver", async () => {
      const { ns, to, emit } = makeNamespace();
      vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([
        makeMembership(LeaverId),
      ] as never);

      await dropSeatsForParticipant(ns as never, ExperimentId, LeaverId);

      expect(to).toHaveBeenCalledTimes(CohortSize - 1);
      expect(to).toHaveBeenCalledWith(`experiment:${ExperimentId}:p0`);
      expect(to).not.toHaveBeenCalledWith(`experiment:${ExperimentId}:${LeaverId}`);
      expect(emit).toHaveBeenCalledWith(
        "exp:alert",
        expect.objectContaining({ type: "partner-withdrawn" }),
      );
    });

    it("does not alert seats that had already dropped", async () => {
      const { ns, to } = makeNamespace();
      vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([
        makeMembership("p6", ["p7"]),
      ] as never);

      await dropSeatsForParticipant(ns as never, ExperimentId, "p6");

      expect(to).toHaveBeenCalledTimes(CohortSize - 2);
      expect(to).not.toHaveBeenCalledWith(`experiment:${ExperimentId}:p7`);
    });

    it("closes the session only when the last active seat drops", async () => {
      const { ns } = makeNamespace();
      const everyoneElse = ["p0", "p1", "p2", "p3", "p4", "p5", "p6"];
      vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([
        makeMembership(LeaverId, everyoneElse),
      ] as never);

      const result = await dropSeatsForParticipant(ns as never, ExperimentId, LeaverId);

      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: SessionId },
        data: { status: "CLOSED" },
      });
      expect(result.closedSessionIds).toEqual([SessionId]);
    });

    it("does nothing for a participant who is in no active session", async () => {
      const { ns, to } = makeNamespace();
      vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([] as never);

      const result = await dropSeatsForParticipant(ns as never, ExperimentId, "solo-1");

      expect(prisma.sessionParticipant.update).not.toHaveBeenCalled();
      expect(to).not.toHaveBeenCalled();
      expect(result).toEqual({ droppedSessionIds: [], closedSessionIds: [] });
    });
  });

  describe("reconnect grace", () => {
    it("uses a thirty second window", () => {
      expect(ReconnectGraceMs).toBe(30_000);
    });

    it("drops the seat only after the grace elapses", () => {
      vi.useFakeTimers();
      const onExpiry = vi.fn();

      scheduleSeatDrop(LeaverId, onExpiry);
      vi.advanceTimersByTime(ReconnectGraceMs - 1);
      expect(onExpiry).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onExpiry).toHaveBeenCalledTimes(1);
    });

    it("cancels the pending drop when the participant reconnects", () => {
      vi.useFakeTimers();
      const onExpiry = vi.fn();

      scheduleSeatDrop(LeaverId, onExpiry);
      expect(cancelSeatDrop(LeaverId)).toBe(true);
      vi.advanceTimersByTime(ReconnectGraceMs * 2);

      expect(onExpiry).not.toHaveBeenCalled();
    });

    it("reports that there was no pending drop to cancel", () => {
      expect(cancelSeatDrop("never-disconnected")).toBe(false);
    });

    it("replaces an earlier pending drop rather than firing twice", () => {
      vi.useFakeTimers();
      const first = vi.fn();
      const second = vi.fn();

      scheduleSeatDrop(LeaverId, first);
      scheduleSeatDrop(LeaverId, second);
      vi.advanceTimersByTime(ReconnectGraceMs);

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });

    it("reports a failing onExpiry as SERVER_TASK, attributed to the participant", async () => {
      vi.useFakeTimers();
      vi.spyOn(console, "error").mockImplementation(() => {});
      const records: ErrorRecord[] = [];
      setErrorSink((r) => records.push(r));

      scheduleSeatDrop(LeaverId, () => Promise.reject(new Error("drop failed")));
      await vi.advanceTimersByTimeAsync(ReconnectGraceMs);
      setErrorSink(consoleSink);

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ source: "SERVER_TASK", participantId: LeaverId });
    });
  });
});
