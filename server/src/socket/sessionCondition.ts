/**
 * Condition applied when a participant has none assigned. Matches the
 * `ExperimentContent.condition` column default and `deliverContent`'s
 * `state.condition ?? "Basic"` fallback.
 */
export const DefaultCondition = "Basic";

export interface SessionSeatCondition {
  seat: number;
  condition: string | null;
}

/**
 * Resolve the single condition every member of a session must use when
 * deriving its rotation index.
 *
 * Members of one session may hold different conditions, but the rotation
 * schedule is a property of the cohort: if each member counted round-robin
 * routines through their own condition's content rows they would land on
 * different rotations and pair asymmetrically (defect B9).
 *
 * The anchor is the occupant of the LOWEST SEAT. Seats are assigned once at
 * match time and never change, so every member computes the same answer
 * regardless of row order and regardless of who is asking.
 *
 * Pass the FULL seat roster, including seats marked DROPPED, and never filter
 * it to ACTIVE members: the anchor must not move when somebody withdraws, or
 * the surviving members all jump to a different rotation mid-session.
 */
export function resolveSessionCondition(
  seats: readonly SessionSeatCondition[],
): string {
  if (seats.length === 0) return DefaultCondition;
  const anchor = seats.reduce((lowest, seat) =>
    seat.seat < lowest.seat ? seat : lowest,
  );
  return anchor.condition ?? DefaultCondition;
}
