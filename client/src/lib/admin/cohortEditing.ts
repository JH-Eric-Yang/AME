import type { MatchingConfig, MatchingSlot, PropertyFilter, RoleAssignment } from "ame-shared";
import type { SessionDesign, SessionDesignIssue } from "ame-shared/sessionDesign";
import { resizeSlots } from "$lib/admin/slotEditing";

/**
 * matchingHandler multiplies the stored value by 1000, so the unit is seconds.
 * Mirrors the default the Builder's RoutineInspector offers for a matching routine.
 */
export const DefaultTimeoutSeconds = 300;
const SecondsPerHour = 3600;
/** Above an hour a stranded participant is effectively never timed out. */
export const MaxReasonableTimeoutSeconds = SecondsPerHour;

/**
 * Resize the cohort. `cohortSize` and `seats.length` must never disagree — the
 * compiler reads one for the rotation and the matching handler reads the other
 * for the slots — so the size is always taken from the resized list rather than
 * from the typed number, which resizeSlots may have clamped or ignored.
 */
export function applyCohortSize(
  seats: MatchingSlot[],
  count: number,
): Pick<SessionDesign, "cohortSize" | "seats"> {
  const resized = resizeSlots(seats, count);
  return { cohortSize: resized.length, seats: resized };
}

/** Rename one seat, leaving its filters and every other seat untouched. */
export function renameSeat(
  seats: MatchingSlot[],
  index: number,
  name: string,
): MatchingSlot[] {
  if (index < 0 || index >= seats.length) return seats;
  return seats.map((seat, i) => (i === index ? { ...seat, name } : seat));
}

/**
 * Replace one seat's property filters.
 *
 * An emptied list drops the `filters` key rather than storing `[]`, so a seat
 * the researcher cleared reads as filterless to validateSessionDesign's
 * "property strategy with a filterless seat" rule.
 */
export function setSeatFilters(
  seats: MatchingSlot[],
  index: number,
  filters: PropertyFilter[],
): MatchingSlot[] {
  if (index < 0 || index >= seats.length) return seats;
  return seats.map((seat, i) => {
    if (i !== index) return seat;
    // MatchingSlot is { name, filters? } — rebuilding from `name` is the whole seat.
    if (filters.length === 0) return { name: seat.name };
    return { ...seat, filters };
  });
}

/**
 * The design's cohort seen as the `MatchingConfig` it compiles to.
 *
 * `describeAssignment` and `validateRoleAssignment` both read a MatchingConfig,
 * and they must be told what this block will actually ship — the seats it
 * compiles into slots and the strategy it compiles onto the routine — rather
 * than a shape assembled differently at each call site.
 */
export function matchingForDesign(design: SessionDesign): MatchingConfig {
  return {
    strategy: design.strategy,
    slots: design.seats,
    ...(design.assignment ? { assignment: design.assignment } : {}),
  };
}

/**
 * Switch the assignment mode, seeding counterbalancing with the scheme that
 * balances in the fewest sessions.
 *
 * Property matching lets its slot filters decide placement, so an assignment
 * held under it would be either ignored at run time or refused at save; the
 * design drops it instead of carrying a choice that cannot ship.
 */
export function applyAssignmentMode(mode: string): Partial<SessionDesign> {
  if (mode === "counterbalanced") {
    return { assignment: { mode: "counterbalanced", set: "rotation", order: "sequential" } };
  }
  return { assignment: undefined };
}

/** Change one field of an existing counterbalanced assignment. */
export function applyAssignmentField(
  assignment: RoleAssignment | undefined,
  patch: { set?: "rotation" | "permutation"; order?: "sequential" | "block-shuffled" },
): Partial<SessionDesign> {
  if (assignment?.mode !== "counterbalanced") return {};
  return { assignment: { ...assignment, ...patch } };
}

/** Label for a seat's filter disclosure button. */
export function seatFilterLabel(seat: MatchingSlot, open: boolean): string {
  if (open) return "- filters";
  const count = seat.filters?.length ?? 0;
  return count > 0 ? `filters (${count})` : "+ filters";
}

/**
 * Parse the timeout field. A cleared or negative field patches nothing, so
 * clearing the input mid-edit cannot write NaN into the design.
 */
export function applyTimeoutSeconds(text: string): Partial<SessionDesign> {
  const seconds = Number.parseInt(text, 10);
  if (!Number.isInteger(seconds) || seconds < 0) return {};
  return { timeoutSeconds: seconds };
}

/** Warning shown under the timeout field, or null when the value is sane. */
export function timeoutWarning(seconds: number): string | null {
  if (seconds <= MaxReasonableTimeoutSeconds) return null;
  const hours = Math.round(seconds / SecondsPerHour);
  return `Over an hour — a stranded participant waits about ${hours}h before the timeout fires.`;
}

/**
 * Issues this rail renders inline, under the control they name.
 *
 * validateSessionDesign's field vocabulary is fixed: "cohortSize" | "strategy" |
 * "seats" | `seats.<i>` | "pattern" | `pattern.steps.<i>` | "trials" |
 * "trialRoutine" | "interTrialRoutine" | "conditions" | "partnerUnavailableText".
 * An indexed field belongs to the group it is prefixed with, so asking for
 * "seats" also returns every `seats.<i>`. An issue with no `field` is not shown
 * here — it belongs to the apply bar, which renders every issue.
 */
export function issuesForField(
  issues: SessionDesignIssue[],
  field: string,
): SessionDesignIssue[] {
  const indexedPrefix = `${field}.`;
  return issues.filter(
    (issue) =>
      issue.field === field || (issue.field?.startsWith(indexedPrefix) ?? false),
  );
}
