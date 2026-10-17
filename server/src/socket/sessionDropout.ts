import type { Namespace } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "ame-shared";
import prisma from "../prisma.js";
import { activeParticipantIds, hasActiveMembers } from "./sessionMembership.js";
import { closeSession, releaseStaleBarrier } from "./progressHandler.js";
import { pushAdminSessionUpdate } from "./adminHandler.js";
import { reportError } from "../errors/reportError.js";

type TypedNamespace = Namespace<ClientToServerEvents, ServerToClientEvents>;

/**
 * How long a disconnected participant may be gone before their seat is marked
 * DROPPED. A page refresh reconnects in well under a second; this window keeps
 * that from orphaning a seat, while a closed tab still frees the cohort.
 */
export const ReconnectGraceMs = 30_000;

/** Alert copy for the members left behind. Covers withdrawal and lost connection alike. */
const PartnerDroppedMessage =
  "A participant in your session is no longer available. The study continues without them.";

const PendingSeatDrops = new Map<string, NodeJS.Timeout>();

export interface DropResult {
  /** Sessions in which this participant's seat was marked DROPPED. */
  droppedSessionIds: string[];
  /** Sessions closed because this was their last active seat. */
  closedSessionIds: string[];
}

/**
 * Mark every active seat held by `participantId` as DROPPED, tell the seats that
 * remain, release a barrier the departed member was holding up, and close a
 * session only once nobody active is left in it.
 *
 * The cohort keeps its seat count, so the rotation schedule is unaffected.
 */
export async function dropSeatsForParticipant(
  ns: TypedNamespace,
  experimentId: string,
  participantId: string,
): Promise<DropResult> {
  cancelSeatDrop(participantId);

  const memberships = await prisma.sessionParticipant.findMany({
    where: {
      participantId,
      status: "ACTIVE",
      session: { experimentId, status: "ACTIVE" },
    },
    include: { session: { include: { participants: true } } },
  });

  const result: DropResult = { droppedSessionIds: [], closedSessionIds: [] };
  const droppedAt = new Date();

  for (const membership of memberships) {
    await prisma.sessionParticipant.update({
      where: { id: membership.id },
      data: { status: "DROPPED", droppedAt },
    });
    result.droppedSessionIds.push(membership.sessionId);

    const remaining = membership.session.participants.filter(
      (member) => member.participantId !== participantId,
    );
    const remainingActiveIds = activeParticipantIds(remaining);

    for (const peerId of remainingActiveIds) {
      ns.to(`experiment:${experimentId}:${peerId}`).emit("exp:alert", {
        message: PartnerDroppedMessage,
        type: "partner-withdrawn",
      });
    }

    if (remainingActiveIds.length > 0) {
      // The cohort may already be sitting at the proceed barrier waiting for the
      // participant who just left. The barrier set was captured before this drop,
      // so nothing else will ever release it.
      await releaseStaleBarrier(ns, membership.sessionId, remainingActiveIds);
    }

    if (!hasActiveMembers(remaining)) {
      // closeSession also releases the barrier — advancing anyone still
      // waiting in it, since their cohort is gone — and notifies the dashboard
      // of the final CLOSED status.
      await closeSession(ns, membership.sessionId, experimentId);
      result.closedSessionIds.push(membership.sessionId);
    } else {
      // The seat is DROPPED but the cohort continues, so the card must show a
      // dropped seat rather than a stale full roster.
      await pushAdminSessionUpdate(experimentId, membership.sessionId);
    }
  }

  return result;
}

/** Arm the reconnect grace for a disconnected participant. Replaces any pending drop. */
export function scheduleSeatDrop(
  participantId: string,
  onExpiry: () => void | Promise<void>,
): void {
  cancelSeatDrop(participantId);
  const timer = setTimeout(() => {
    PendingSeatDrops.delete(participantId);
    // onExpiry awaits unguarded prisma calls. There is no process-level
    // unhandledRejection handler, so a transient DB error here would terminate
    // the process and drop EVERY live participant's socket mid-experiment.
    void Promise.resolve(onExpiry()).catch((err) => {
      console.error(
        `[scheduleSeatDrop] Seat drop for ${participantId} failed:`,
        err,
      );
      reportError(err, {
        source: "SERVER_TASK",
        participantId,
        context: { task: "scheduleSeatDrop" },
      });
    });
  }, ReconnectGraceMs);
  timer.unref?.();
  PendingSeatDrops.set(participantId, timer);
}

/**
 * True while a drop is already counting down for this participant.
 *
 * The periodic sweep asks before arming: re-arming on every pass would push
 * the deadline back for ever, and a participant who closed their tab would
 * never actually be dropped.
 */
export function hasPendingSeatDrop(participantId: string): boolean {
  return PendingSeatDrops.has(participantId);
}

/** Disarm the grace because the participant came back. True when a drop was pending. */
export function cancelSeatDrop(participantId: string): boolean {
  const timer = PendingSeatDrops.get(participantId);
  if (!timer) return false;
  clearTimeout(timer);
  PendingSeatDrops.delete(participantId);
  return true;
}
