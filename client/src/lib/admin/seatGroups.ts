import { formatSeatGroups, parseSeatGroups } from "ame-shared/sessionDesign";
import { computeRoundRobinRotations } from "ame-shared/interactionGroups";

/**
 * Editing logic for the explicit pairing table (design/ExplicitTable.dc.html).
 *
 * Seats are 1-based in the text a researcher types and 0-based in the stored
 * `InteractionPattern.steps`. The conversion is owned entirely by
 * `parseSeatGroups`/`formatSeatGroups` in `ame-shared/sessionDesign` and is
 * never re-implemented here.
 */

/** A table always keeps one trial; removing the last row is refused. */
export const MinTrialCount = 1;
/** A practical ceiling — 48 trials of video chat is already a long session. */
export const MaxTrialCount = 48;

/** Matches the compact column label ("T4") the table renders per row. */
const CompactTrialLabel = /^T(\d+)$/;

/**
 * The `parseSeatGroups` messages that must stop the row being emitted: the text
 * is not a pairing yet, names a seat that does not exist, or leaves a seat on
 * its own. Its two remaining messages ("appears N times", "is not assigned")
 * describe a row that parsed perfectly well but does not cover the cohort —
 * those are re-derived below as `headline`/`detail`, are blocking only at Apply
 * time via `validateSessionDesign`, and are deliberately kept out of
 * `blockingIssues` so the row banner never prints the same complaint twice.
 */
const BlockingIssueMarkers = [
  "is not a seat number",
  "is outside the cohort",
  "has no partner",
];

export interface SeatRowState {
  /** 0-based groups, as stored. Best-effort while the text is mid-edit. */
  groups: number[][];
  /** Distinct seats assigned — a seat written twice is still one seat. */
  distinctSeats: number;
  /** Badge text, e.g. "8 of 8". */
  badge: string;
  /** False turns the badge and the input border red. */
  badgeOk: boolean;
  /** One-line coverage complaint, already prefixed with the trial name. */
  headline: string | null;
  /** The sentence under the headline naming the offending seats. */
  detail: string | null;
  /** Parse-level messages only; coverage complaints live in headline/detail. */
  blockingIssues: string[];
  /** Whether the parent may be handed these groups. False mid-keystroke. */
  canEmit: boolean;
}

/** "T4" becomes "Trial 4" for prose; anything else is used verbatim. */
export function trialSentenceLabel(trialLabel: string): string {
  const match = CompactTrialLabel.exec(trialLabel);
  return match ? `Trial ${match[1]}` : trialLabel;
}

/** "seat 6" / "seats 6 and 7" / "seats 4, 5, 6 and 7" — seats are 1-based here. */
function joinSeats(seats: number[]): string {
  if (seats.length === 1) return `seat ${seats[0]}`;
  const head = seats.slice(0, -1).join(", ");
  return `seats ${head} and ${seats[seats.length - 1]}`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** How many times each 0-based seat appears across the row's groups. */
function seatCounts(groups: number[][], cohortSize: number): number[] {
  const counts = new Array<number>(cohortSize).fill(0);
  for (const group of groups) {
    for (const seat of group) {
      if (seat >= 0 && seat < cohortSize) counts[seat] += 1;
    }
  }
  return counts;
}

/** "seat 3 appears in 3-5 and 3-8" — quotes the row back in its own notation. */
function describeRepeat(seat: number, groups: number[][]): string {
  const written = groups
    .filter((group) => group.includes(seat - 1))
    .map((group) => formatSeatGroups([group]));
  return `seat ${seat} appears in ${written.join(" and ")}`;
}

/**
 * Read one trial row of the explicit table.
 *
 * A row that parses but does not cover the cohort is still emitted: coverage is
 * blocking at Apply time (`validateSessionDesign`), not at keystroke time, so a
 * researcher can leave a row half-edited and come back to it. A row that does
 * not parse at all is withheld, because emitting it would silently drop pairs.
 */
export function readSeatRow(
  text: string,
  cohortSize: number,
  trialLabel: string,
): SeatRowState {
  const { groups, issues } = parseSeatGroups(text, cohortSize);
  const blockingIssues = issues.filter((issue) =>
    BlockingIssueMarkers.some((marker) => issue.includes(marker)),
  );
  const counts = seatCounts(groups, cohortSize);

  const missing: number[] = [];
  const repeated: number[] = [];
  counts.forEach((count, seat) => {
    if (count === 0) missing.push(seat + 1);
    else if (count > 1) repeated.push(seat + 1);
  });

  const clauses: string[] = [];
  const details: string[] = [];

  if (missing.length > 0) {
    clauses.push(`leaves ${joinSeats(missing)} unassigned`);
    details.push(
      `${capitalise(joinSeats(missing))} ${missing.length === 1 ? "has" : "have"} no partner`,
    );
  }
  if (repeated.length > 0) {
    clauses.push(
      counts.some((count) => count > 2)
        ? `assigns ${joinSeats(repeated)} more than once`
        : `pairs ${joinSeats(repeated)} twice`,
    );
    for (const seat of repeated) details.push(describeRepeat(seat, groups));
  }

  const distinct = counts.filter((count) => count > 0).length;

  return {
    groups,
    distinctSeats: distinct,
    badge: `${distinct} of ${cohortSize}`,
    badgeOk: blockingIssues.length === 0 && clauses.length === 0,
    headline:
      clauses.length > 0
        ? `${trialSentenceLabel(trialLabel)} ${clauses.join(" and ")}.`
        : null,
    detail:
      details.length > 0
        ? `Every seat must appear exactly once per trial. ${details.join("; ")}.`
        : null,
    blockingIssues,
    canEmit: blockingIssues.length === 0,
  };
}

/**
 * Decide whether an incoming `groups` prop should replace the text a researcher
 * is typing.
 *
 * `syncedText` is the formatted text the row last agreed on with its parent.
 * Returning null means the parent is only echoing back what was just typed, so
 * the input is left alone; a string means the parent genuinely changed the row
 * (seeding, or an added trial) and the input is reset to it.
 */
export function reseedRowText(
  syncedText: string,
  incomingGroups: number[][],
): string | null {
  const incoming = formatSeatGroups(incomingGroups);
  return incoming === syncedText ? null : incoming;
}

/** A defensive copy, so two rows seeded from one rotation are never aliased. */
function copyStep(step: number[][]): number[][] {
  return step.map((group) => [...group]);
}

/**
 * Seed `trials` rows from the round-robin schedule, wrapping when more trials
 * are asked for than the schedule has rotations. Wrapping repeats a pairing
 * rather than leaving a blank row — the coverage matrix shows the repeat.
 */
export function seedStepsFromRoundRobin(
  cohortSize: number,
  groupSize: number,
  trials: number,
): number[][][] {
  const rotations = computeRoundRobinRotations(cohortSize, groupSize);
  const count = Math.min(Math.max(trials, MinTrialCount), MaxTrialCount);
  return Array.from({ length: count }, (_, i) =>
    copyStep(rotations[i % rotations.length]),
  );
}

/** Append one trial, seeded from the rotation that follows the last row. */
export function appendTrial(
  steps: number[][][],
  cohortSize: number,
  groupSize: number,
): number[][][] {
  if (steps.length >= MaxTrialCount) return steps;
  const rotations = computeRoundRobinRotations(cohortSize, groupSize);
  return [...steps, copyStep(rotations[steps.length % rotations.length])];
}

/** Remove one trial. The last remaining row and an out-of-range index are kept. */
export function removeTrial(steps: number[][][], index: number): number[][][] {
  if (steps.length <= MinTrialCount) return steps;
  if (index < 0 || index >= steps.length) return steps;
  return steps.filter((_, i) => i !== index);
}
