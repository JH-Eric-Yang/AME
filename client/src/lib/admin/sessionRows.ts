import type { SessionGroupingSummary, SessionSummary } from "ame-shared";
import { formatSeatGroups } from "ame-shared/sessionDesign";
import { participantLabel } from "./queueRows";

/** A group of one seat means that seat is on its own this trial. */
const SoloGroupSize = 1;
/** Shown for a seat whose scheduled partner is not there. Mirrors the runtime notice. */
const PartnerUnavailableLabel = "Partner unavailable";
/** Shown for a seat with no group at the current progress, and for a dropped seat. */
const NoPartnerLabel = "—";
const SeatLabelPrefix = "Seat ";
const ShortSessionIdLength = 8;

/**
 * The 1-based label for a stored 0-based seat.
 *
 * Seats are 1-based in every UI surface and 0-based in stored JSON, and
 * `formatSeatGroups` is the ONE place that conversion is allowed to live —
 * so a single-seat group is formatted rather than incremented here.
 */
export function seatLabel(seat: number): string {
  return formatSeatGroups([[seat]]);
}

export interface PairingChip {
  /**
   * The chip's list key. Unique within a session by the SessionGrouping upsert
   * key (sessionId, progress, groupIndex), whereas `text` is not: two groups
   * that both lost every seat render "? — solo" twice, and a duplicate key
   * makes Svelte throw rather than degrade.
   */
  groupIndex: number;
  /** "1 ↔ 4", or "5 — solo". */
  text: string;
  solo: boolean;
}

/** The pairing showing right now, one chip per group, in schedule order. */
export function pairingChips(session: SessionSummary): PairingChip[] {
  return session.groupings.map((group) => {
    const labels = group.seats.map(seatLabel);
    return group.seats.length <= SoloGroupSize
      ? { groupIndex: group.groupIndex, text: `${labels[0] ?? "?"} — solo`, solo: true }
      : { groupIndex: group.groupIndex, text: labels.join(" ↔ "), solo: false };
  });
}

export interface SeatRow {
  /** 0-based, used only as a list key. */
  seat: number;
  label: string;
  occupant: string;
  status: "ACTIVE" | "DROPPED";
  progressLabel: string;
  partner: string;
}

const groupForSeat = (
  groupings: readonly SessionGroupingSummary[],
  seat: number,
): SessionGroupingSummary | null =>
  groupings.find((group) => group.seats.includes(seat)) ?? null;

/**
 * One row per seat of the cohort, dropped seats included.
 *
 * A dropped seat shows no partner at all — it is out of the schedule. A seat
 * whose group survived but lost everyone else shows "Partner unavailable",
 * which is the case the design calls out: seat 3 leaves, and seat 5 — the
 * partner it was scheduled with this trial — sits out rather than the cohort
 * stalling on somebody who closed their tab.
 */
export function seatRows(session: SessionSummary): SeatRow[] {
  return session.seats.map((seatSummary) => {
    const group =
      seatSummary.status === "DROPPED"
        ? null
        : groupForSeat(session.groupings, seatSummary.seat);
    const partnerSeats = group
      ? group.seats.filter((other) => other !== seatSummary.seat)
      : [];

    let partner = NoPartnerLabel;
    if (partnerSeats.length > 0) {
      partner = partnerSeats
        .map((other) => `${SeatLabelPrefix}${seatLabel(other)}`)
        .join(", ");
    } else if (group) {
      partner = PartnerUnavailableLabel;
    }

    return {
      seat: seatSummary.seat,
      label: `${SeatLabelPrefix}${seatLabel(seatSummary.seat)}`,
      occupant: participantLabel(seatSummary),
      status: seatSummary.status,
      progressLabel: `p${seatSummary.progress}`,
      partner,
    };
  });
}

export interface SessionHeading {
  shortId: string;
  blockLabel: string;
  trialLabel: string;
  statusLabel: string;
}

export function sessionHeading(session: SessionSummary): SessionHeading {
  // blockLabel first: blockId is the design's id (e.g. "blk-a1f3"), which is
  // stable provenance but not something to print. It stays in the chain so a
  // summary assembled without designs still names something.
  const owner = session.blockLabel ?? session.blockId ?? session.routineName;
  // The trial TOTAL lives in the authored SessionDesign, not on the runtime
  // session, so the live trial number is shown without a denominator rather
  // than with a guessed one.
  const trialLabel =
    session.currentProgress === null
      ? "Not started"
      : `Trial ${session.currentTrialNumber ?? 1} · progress ${session.currentProgress}`;
  return {
    shortId: session.sessionId.slice(0, ShortSessionIdLength),
    blockLabel: `${owner} · ${session.seatCount} seats`,
    trialLabel,
    statusLabel: `${session.status.charAt(0)}${session.status.slice(1).toLowerCase()}`,
  };
}
