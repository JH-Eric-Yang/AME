/**
 * participantRef — turning `self` / `partner:k` / `seat:n` into a participant
 * id, given who is in the session and who is in the current interaction group.
 *
 * Shared by the server's reference resolver and (from Phase 3) the client's
 * video-chat tiles, so both sides agree on what "partner:2" means.
 */

import type { ParticipantRef } from "./refs.js";
import type { SessionMember } from "./types.js";

export type { SessionMember } from "./types.js";

export interface AddressingContext {
  selfId: string;
  /** Every seat in the session, self included. Null outside a matching block. */
  session: { members: SessionMember[] } | null;
  /** The members this participant is currently grouped with, self included. */
  group: { members: SessionMember[] } | null;
}

export type AddressingFailure = "no-session" | "partner-index-out-of-range" | "seat-empty";

export type AddressingResult =
  | { ok: true; participantId: string }
  | { ok: false; reason: AddressingFailure };

const bySeat = (a: SessionMember, b: SessionMember): number => a.seat - b.seat;

export function resolveParticipant(ref: ParticipantRef, ctx: AddressingContext): AddressingResult {
  switch (ref.kind) {
    case "self":
      return { ok: true, participantId: ctx.selfId };

    case "partner": {
      if (!ctx.session || !ctx.group) return { ok: false, reason: "no-session" };
      const others = ctx.group.members
        .filter((m) => m.participantId !== ctx.selfId)
        .sort(bySeat);
      const partner = others[ref.k - 1];
      return partner
        ? { ok: true, participantId: partner.participantId }
        : { ok: false, reason: "partner-index-out-of-range" };
    }

    case "seat": {
      if (!ctx.session) return { ok: false, reason: "no-session" };
      // The grammar is 1-based; SessionParticipant.seat is 0-based.
      const member = ctx.session.members.find((m) => m.seat === ref.n - 1);
      return member
        ? { ok: true, participantId: member.participantId }
        : { ok: false, reason: "seat-empty" };
    }
  }
}
