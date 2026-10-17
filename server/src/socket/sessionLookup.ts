/**
 * sessionLookup — reading a participant's seat and cohort. Shared by content
 * delivery and group assignment; lives apart from progressHandler so the group
 * module can use it without importing the handler.
 */

import type { SessionMember } from "ame-shared";
import prisma from "../prisma.js";
import type { SeatStatus } from "./sessionMembership.js";

export interface SessionInfoResult {
  seat: number;
  slotName: string | null;
  session: {
    id: string;
    /** The matching routine that formed the session. */
    routineName: string;
    matchProgress: number;
    sharedProgressSequence: number[] | null;
    /**
     * The FULL cohort as matched, never filtered. `seatCount` is derived from
     * this length and must not shrink when a member drops, or
     * computeRoundRobinRotations degrades to a single all-seats group (B8).
     * `condition` anchors the rotation index (B9) and must survive a dropout,
     * so the DROPPED rows stay in the array.
     */
    participants: Array<{
      participantId: string;
      seat: number;
      slotName: string | null;
      condition: string | null;
      status: SeatStatus;
    }>;
  };
}

export async function findActiveSession(
  participantId: string,
  experimentId: string,
): Promise<SessionInfoResult | null> {
  const sp = await prisma.sessionParticipant.findFirst({
    where: {
      participantId,
      // The caller's OWN seat must still be occupied. A participant whose seat
      // has DROPPED is no longer part of the cohort: without this they would be
      // handed a session whose barrier and advanceSession both exclude them,
      // and they would stall forever. They now continue solo instead.
      status: "ACTIVE",
      session: {
        experimentId,
        status: "ACTIVE",
      },
    },
    include: {
      session: {
        include: {
          participants: {
            select: {
              participantId: true,
              seat: true,
              slotName: true,
              status: true,
              participant: { select: { condition: true } },
            },
          },
        },
      },
    },
  });

  if (!sp) return null;

  return {
    seat: sp.seat,
    slotName: sp.slotName,
    session: {
      id: sp.session.id,
      routineName: sp.session.routineName,
      matchProgress: sp.session.matchProgress,
      sharedProgressSequence: sp.session.sharedProgressSequence as number[] | null,
      participants: sp.session.participants.map((p) => ({
        participantId: p.participantId,
        seat: p.seat,
        slotName: p.slotName,
        condition: p.participant.condition,
        status: p.status,
      })),
    },
  };
}

/**
 * The seat this participant held before it was released, newest first.
 *
 * `findActiveSession` deliberately ignores a DROPPED seat, so it cannot answer
 * "was this solo participant once part of a cohort?". The session itself may
 * already be CLOSED — the last seat to drop closes it — so session status is
 * not filtered here.
 */
export async function findDroppedSeat(
  participantId: string,
  experimentId: string,
): Promise<{ seat: number } | null> {
  return prisma.sessionParticipant.findFirst({
    where: {
      participantId,
      status: "DROPPED",
      session: { experimentId },
    },
    orderBy: { droppedAt: "desc" },
    select: { seat: true },
  });
}

/** The whole cohort as members, dropped seats included, ordered by seat. */
export function sessionMembersOf(info: SessionInfoResult): SessionMember[] {
  return [...info.session.participants]
    .sort((a, b) => a.seat - b.seat)
    .map(({ participantId, seat, slotName }) => ({ participantId, seat, slotName }));
}
