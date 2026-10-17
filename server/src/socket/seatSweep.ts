import type { Namespace } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "ame-shared";
import prisma from "../prisma.js";
import type { SocketState } from "./index.js";
import { reportError } from "../errors/reportError.js";
import {
  dropSeatsForParticipant,
  hasPendingSeatDrop,
  scheduleSeatDrop,
} from "./sessionDropout.js";

type TypedNamespace = Namespace<ClientToServerEvents, ServerToClientEvents>;

/**
 * How often to look for seats nobody is counting down.
 *
 * Short enough that a cohort is not left waiting long past the grace, long
 * enough that the query is negligible: one indexed read of the ACTIVE seats,
 * and none of the sockets at all when no session is running.
 */
export const SeatSweepIntervalMs = 15_000;

/**
 * Re-arm the reconnect grace for any seat that has nobody counting it down.
 *
 * The grace is a `setTimeout` held in the process, so a restart inside the
 * window loses it: the departed seat stays ACTIVE for the rest of the run and
 * the cohort waits at the proceed barrier on somebody who has gone, until the
 * experiment's activeTime finally withdraws them.
 *
 * This arms the SAME grace the disconnect handler arms rather than dropping
 * the seat outright, so a participant whose browser reconnects after a restart
 * still gets their full window and cancels the drop exactly as before. The
 * cost of a restart is therefore a delay, never a wrongly dropped seat.
 *
 * Returns the participants it armed, which is also what makes it testable.
 */
export async function sweepAbandonedSeats(
  ns: TypedNamespace,
): Promise<string[]> {
  const seats = await prisma.sessionParticipant.findMany({
    where: { status: "ACTIVE", session: { status: "ACTIVE" } },
    select: { participantId: true, session: { select: { experimentId: true } } },
  });
  // Nothing is running, so do not pay for a cluster-wide socket round trip.
  if (seats.length === 0) return [];

  const connected = new Set<string>();
  for (const socket of await ns.fetchSockets()) {
    const { participantId } = socket.data as SocketState;
    if (participantId) connected.add(participantId);
  }

  const armed: string[] = [];
  for (const seat of seats) {
    const participantId = seat.participantId;
    if (connected.has(participantId)) continue;
    // Also the one-grace-per-participant guard: a participant holding seats in
    // two sessions is armed once, and dropSeatsForParticipant releases both.
    if (hasPendingSeatDrop(participantId)) continue;

    const { experimentId } = seat.session;
    scheduleSeatDrop(participantId, async () => {
      await dropSeatsForParticipant(ns, experimentId, participantId);
    });
    armed.push(participantId);
  }

  // A sweep whose read races a drop that is committing can arm one more grace
  // for a seat that is already going: the timer has fired (so nothing is
  // pending) while the row still reads ACTIVE. That grace expires against a
  // seat with no ACTIVE membership and does nothing, and the next sweep sees
  // DROPPED — so it costs one no-op and cannot repeat.
  if (armed.length > 0) {
    console.warn(
      `[seatSweep] Re-armed the reconnect grace for ${armed.length} seat(s) nobody was counting down: ${armed.join(", ")}`,
    );
  }
  return armed;
}

/** Run the sweep on a timer. Returns the function that stops it. */
export function startSeatSweep(ns: TypedNamespace): () => void {
  const timer = setInterval(() => {
    // setInterval never awaits this, so an unhandled rejection here would end
    // the process and every live participant's socket with it.
    void sweepAbandonedSeats(ns).catch((err) => {
      console.error("[seatSweep] sweep failed:", err);
      reportError(err, { source: "SERVER_TASK", context: { task: "seatSweep" } });
    });
  }, SeatSweepIntervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
