/**
 * groupAssignment — which members this participant is grouped with on this
 * step, as data. Content delivery needs the group before it resolves
 * `partner`/`seat` references, and the phone's catch-up delivery needs the same
 * answer without re-recording provenance, so the side effects (the grouping
 * row, the dashboard push, the solo warning) stay with the caller.
 *
 * The branches are the interaction-group logic that used to sit inline in
 * deliverContent, moved without behaviour change; only `members` is new.
 */

import type { ContentPayload, InteractionPattern, RoutineConfig, SessionMember } from "ame-shared";
import { getInteractionGroup, computeRotationIndex } from "ame-shared/interactionGroups";
import prisma from "../prisma.js";
import { activeMembers } from "./sessionMembership.js";
import { resolveSessionCondition } from "./sessionCondition.js";
import { findDroppedSeat, type SessionInfoResult } from "./sessionLookup.js";

export interface GroupAssignment {
  interactionGroup: NonNullable<ContentPayload["interactionGroup"]> & { members: SessionMember[] };
  /** Present only for a pattern-driven group: what deliverContent records and warns about. */
  provenance: {
    patternType: InteractionPattern["type"];
    groupPeers: number[];
    seatCount: number;
    groupIndex: number;
    seats: number[];
    participantIds: string[];
  } | null;
}

export interface GroupAssignmentInput {
  sessionInfo: SessionInfoResult | null;
  routine: RoutineConfig;
  routines: RoutineConfig[];
  experimentId: string;
  participantId: string;
  virtualProgress: number;
  trialNumber: number;
}

type Seat = SessionInfoResult["session"]["participants"][number];

const toMember = ({ participantId, seat, slotName }: Seat): SessionMember => ({ participantId, seat, slotName });

export async function assignInteractionGroup(input: GroupAssignmentInput): Promise<GroupAssignment | null> {
  const { sessionInfo, routine, routines, experimentId, participantId, virtualProgress, trialNumber } = input;

  if (sessionInfo && routine.interactionPattern) {
    const matchProgress = sessionInfo.session.matchProgress;
    // The FULL cohort, dropped seats included: shrinking this makes
    // seatCount % groupSize !== 0 and collapses the rotation schedule (B8).
    const seatCount = sessionInfo.session.participants.length;

    // Every member must land on the SAME rotation, so the band is read
    // through the session's anchor condition rather than the requesting
    // participant's own `condition` (defect B9). The anchor is the lowest
    // seat's condition, which stays put when a member drops. Content
    // delivery stays participant-scoped — only this count is session-scoped.
    const rotationCondition = resolveSessionCondition(sessionInfo.session.participants);

    // Build progress→routine map for rotation index calculation
    const contentRows = await prisma.experimentContent.findMany({
      where: {
        experimentId,
        condition: rotationCondition,
        progress: { gt: matchProgress, lt: virtualProgress },
      },
      select: { progress: true, routine: true },
    });
    const progressRoutineMap = new Map<number, RoutineConfig>();
    for (const row of contentRows) {
      const r = routines.find((rt) => rt.name === row.routine);
      if (r) progressRoutineMap.set(row.progress, r);
    }

    const rotationIndex = computeRotationIndex(progressRoutineMap, matchProgress, virtualProgress);

    // Sequence patterns use trial number directly; others use rotation index
    const groupIndex = routine.interactionPattern.type === "sequence" ? trialNumber - 1 : rotationIndex;

    const group = getInteractionGroup(routine.interactionPattern, sessionInfo.seat, seatCount, groupIndex);

    // Map seat numbers to members. A DROPPED seat has no occupant to connect
    // to, so its rotation partner sits this round out rather than being
    // offered somebody who has closed their tab. Only this DERIVED map
    // shrinks — seatCount above still reads the full cohort.
    const bySeat = new Map<number, Seat>(
      activeMembers(sessionInfo.session.participants).map((sp) => [sp.seat, sp]),
    );

    const peers = group.groupPeers
      .map((s) => bySeat.get(s)?.participantId)
      .filter((pid): pid is string => pid !== undefined && pid !== participantId);

    // The provenance payload is derived from the ACTIVE seat map, not the full
    // cohort: advanceSession delivers members sequentially, so a dropout
    // landing between two deliveries shrinks a later member's array and the
    // last writer wins. Every such array is a valid subset of the group, so no
    // data is lost.
    const seats = group.groupPeers.filter((s) => bySeat.has(s)).sort((a, b) => a - b);

    // A seat the pattern scheduled against this one that nobody now occupies.
    // Without this an intentionally solo group — a `sequence` step that omits
    // this seat, or a `fixed` group of one — reads as an empty peer list and
    // the participant is told their partner left when nobody dropped.
    const scheduledButGone = group.groupPeers.some((s) => s !== sessionInfo.seat && !bySeat.has(s));

    return {
      interactionGroup: {
        peers,
        seat: sessionInfo.seat,
        groupIndex: group.groupIndex,
        // seatCount is the FULL cohort, so "> 1" means this participant was
        // matched with somebody and has been left alone.
        partnerUnavailable: peers.length === 0 && seatCount > 1 && scheduledButGone,
        members: seats.map((s) => toMember(bySeat.get(s)!)),
      },
      provenance: {
        patternType: routine.interactionPattern.type,
        groupPeers: group.groupPeers,
        seatCount,
        groupIndex: group.groupIndex,
        seats,
        participantIds: seats.map((s) => bySeat.get(s)!.participantId),
      },
    };
  }

  if (sessionInfo) {
    // No interaction pattern — every ACTIVE session member is a peer. `peers`
    // keeps the cohort's stored order, as it always has; `members` is by seat.
    const active = activeMembers(sessionInfo.session.participants);
    const peers = active.map((p) => p.participantId).filter((pid) => pid !== participantId);
    return {
      interactionGroup: {
        peers,
        seat: sessionInfo.seat,
        groupIndex: 0,
        partnerUnavailable: peers.length === 0 && sessionInfo.session.participants.length > 1,
        members: [...active].sort((a, b) => a.seat - b.seat).map(toMember),
      },
      provenance: null,
    };
  }

  // No ACTIVE seat. Deliberately ungated: cohort size at runtime is
  // matching.slots.length, and participantsPerSession is decorative — the
  // slot editor never writes it, so a Builder-authored rotation leaves it
  // at 1 and a guard on it would swallow every orphan. findDroppedSeat
  // returning a row is itself proof the participant held a seat.
  //
  // If this participant HELD one, they are an orphan whose own seat was
  // released, and an absent interactionGroup is not enough: the client's
  // `payload.interactionGroup ?? s.interactionGroup` would keep their OLD
  // group and they would go on dialling a partner who has gone, never seeing
  // the notice. Send an explicitly empty group instead.
  const droppedSeat = await findDroppedSeat(participantId, experimentId);
  if (!droppedSeat) return null;
  return {
    interactionGroup: { peers: [], seat: droppedSeat.seat, groupIndex: 0, partnerUnavailable: true, members: [] },
    provenance: null,
  };
}
