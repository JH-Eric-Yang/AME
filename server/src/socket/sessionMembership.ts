/**
 * Pure predicates over the seats of a multi-participant session.
 *
 * A cohort's size is fixed when it is matched, so a dropout never changes the
 * seat count the rotation schedule is built from — it only changes which seats
 * are still answering. Everything that must shrink on a dropout (the proceed
 * barrier, the peer list) goes through these helpers; everything that must not
 * (seatCount, the rotation anchor condition) keeps reading the full
 * participants array.
 */

/** Mirrors Prisma's SessionParticipantStatus. */
export type SeatStatus = "ACTIVE" | "DROPPED";

export interface SessionMember {
  participantId: string;
  seat: number;
  status: SeatStatus;
}

/** The seats still occupied, with each caller's extra fields (condition, slotName) intact. */
export function activeMembers<T extends SessionMember>(members: readonly T[]): T[] {
  return members.filter((member) => member.status === "ACTIVE");
}

/** Ids of the seats still occupied. The barrier and advanceSession run on exactly these. */
export function activeParticipantIds(members: readonly SessionMember[]): string[] {
  return activeMembers(members).map((member) => member.participantId);
}

/** False only when every seat has dropped — the one condition that closes a session. */
export function hasActiveMembers(members: readonly SessionMember[]): boolean {
  return members.some((member) => member.status === "ACTIVE");
}
