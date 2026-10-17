import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import prisma from "../prisma.js";
import { sweepAbandonedSeats, startSeatSweep } from "../socket/seatSweep.js";
import {
  ReconnectGraceMs,
  cancelSeatDrop,
  hasPendingSeatDrop,
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

/** One ACTIVE seat, as the sweep's own query returns it. */
function seat(participantId: string, sessionId = "sess-1") {
  return { participantId, session: { experimentId: ExperimentId } , sessionId };
}

/** A namespace whose connected sockets carry these participant ids. */
function namespaceWith(...participantIds: string[]) {
  return {
    to: vi.fn(() => ({ emit: vi.fn() })),
    fetchSockets: vi.fn(async () =>
      participantIds.map((participantId) => ({ data: { participantId } })),
    ),
  };
}

afterEach(() => {
  for (const id of ["p1", "p2", "p3"]) cancelSeatDrop(id);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("sweepAbandonedSeats", () => {
  beforeEach(() => {
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([] as never);
  });

  it("arms the grace for a seat whose participant is not connected", async () => {
    // The restart case: the disconnect timer died with the process, so nothing
    // will ever drop this seat and the cohort waits on someone who has gone.
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([seat("p1")] as never);

    const armed = await sweepAbandonedSeats(namespaceWith("p2") as never);

    expect(armed).toEqual(["p1"]);
    expect(hasPendingSeatDrop("p1")).toBe(true);
  });

  it("leaves a connected participant alone", async () => {
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([seat("p1")] as never);

    const armed = await sweepAbandonedSeats(namespaceWith("p1") as never);

    expect(armed).toEqual([]);
    expect(hasPendingSeatDrop("p1")).toBe(false);
  });

  it("does not disturb a grace that is already running", async () => {
    // Re-arming on every sweep would push the deadline back for ever, so a
    // participant who closed their tab would never actually be dropped.
    const onExpiry = vi.fn();
    scheduleSeatDrop("p1", onExpiry);
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([seat("p1")] as never);

    const armed = await sweepAbandonedSeats(namespaceWith() as never);

    expect(armed).toEqual([]);
    expect(hasPendingSeatDrop("p1")).toBe(true);
  });

  it("arms once for a participant holding a seat in two sessions", async () => {
    // dropSeatsForParticipant already drops every seat they hold.
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([
      seat("p1", "sess-1"),
      seat("p1", "sess-2"),
    ] as never);

    expect(await sweepAbandonedSeats(namespaceWith() as never)).toEqual(["p1"]);
  });

  it("asks only for live seats in live sessions", async () => {
    await sweepAbandonedSeats(namespaceWith() as never);

    const args = vi.mocked(prisma.sessionParticipant.findMany).mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(args.where).toMatchObject({
      status: "ACTIVE",
      session: { status: "ACTIVE" },
    });
  });

  it("does not query the sockets when no session is running", async () => {
    const ns = namespaceWith();

    await sweepAbandonedSeats(ns as never);

    expect(ns.fetchSockets).not.toHaveBeenCalled();
  });

  it("drops the seat once the grace it armed runs out", async () => {
    vi.useFakeTimers();
    vi.mocked(prisma.sessionParticipant.findMany)
      .mockResolvedValueOnce([seat("p1")] as never)
      // The read dropSeatsForParticipant makes when the timer fires.
      .mockResolvedValueOnce([
        {
          id: "sp-p1",
          sessionId: "sess-1",
          participantId: "p1",
          seat: 0,
          status: "ACTIVE",
          session: {
            id: "sess-1",
            status: "ACTIVE",
            participants: [
              { participantId: "p1", seat: 0, status: "ACTIVE" },
              { participantId: "p2", seat: 1, status: "ACTIVE" },
            ],
          },
        },
      ] as never);

    await sweepAbandonedSeats(namespaceWith("p2") as never);
    await vi.advanceTimersByTimeAsync(ReconnectGraceMs + 1);

    expect(prisma.sessionParticipant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sp-p1" },
        data: expect.objectContaining({ status: "DROPPED" }),
      }),
    );
  });
});

describe("startSeatSweep", () => {
  it("survives a sweep that fails instead of taking the process down", async () => {
    // setInterval never awaits the callback, so a rejected query here would be
    // an unhandled rejection and Node would exit, dropping every live socket.
    vi.useFakeTimers();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(prisma.sessionParticipant.findMany).mockRejectedValue(new Error("db down"));

    const stop = startSeatSweep(namespaceWith() as never);
    await vi.advanceTimersByTimeAsync(60_000);
    stop();

    expect(errors).toHaveBeenCalled();
  });

  it("reports a failing sweep as SERVER_TASK, not just to the console", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(prisma.sessionParticipant.findMany).mockRejectedValue(new Error("db down"));
    const records: ErrorRecord[] = [];
    setErrorSink((r) => records.push(r));

    const stop = startSeatSweep(namespaceWith() as never);
    await vi.advanceTimersByTimeAsync(60_000);
    stop();
    setErrorSink(consoleSink);

    expect(records.length).toBeGreaterThan(0);
    expect(records[0]).toMatchObject({ source: "SERVER_TASK" });
  });

  it("stops sweeping once it is told to", async () => {
    vi.useFakeTimers();
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([] as never);

    const stop = startSeatSweep(namespaceWith() as never);
    await vi.advanceTimersByTimeAsync(60_000);
    const sweepsWhileRunning = vi.mocked(prisma.sessionParticipant.findMany).mock.calls.length;
    stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(sweepsWhileRunning).toBeGreaterThan(0);
    expect(vi.mocked(prisma.sessionParticipant.findMany).mock.calls).toHaveLength(
      sweepsWhileRunning,
    );
  });
});

describe("a grace armed against a seat that is already gone", () => {
  it("expires without dropping anything", async () => {
    // The benign duplicate: a sweep read that raced a committing drop. By the
    // time this grace expires the seat holds no ACTIVE membership, so the drop
    // must be a no-op rather than an error or a second DROPPED write.
    vi.useFakeTimers();
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.sessionParticipant.findMany).mockResolvedValueOnce([seat("p3")] as never);

    await sweepAbandonedSeats(namespaceWith() as never);
    await vi.advanceTimersByTimeAsync(ReconnectGraceMs + 1);

    expect(prisma.sessionParticipant.update).not.toHaveBeenCalled();
  });
});
