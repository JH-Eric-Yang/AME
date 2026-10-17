import type { InteractionPattern, RoutineConfig, RoutineType } from "ame-shared";
import type { SessionDesign, SessionDesignIssue } from "ame-shared/sessionDesign";

/** The four choices the Pattern select offers, in design/Main.dc.html's order. */
export type PatternKind = InteractionPattern["type"];

export const PatternOptions: { kind: PatternKind; label: string }[] = [
  { kind: "round-robin", label: "Round-robin (auto)" },
  { kind: "sequence", label: "Explicit table" },
  { kind: "fixed", label: "Fixed groups" },
  { kind: "all", label: "Everyone together" },
];

/** A dyad — the default, and the only size a two-seat cohort can have. */
export const DefaultGroupSize = 2;
/** A schedule with no trials is not a schedule. */
export const MinTrials = 1;
/** Shown in a schedule cell when no group contains this seat on that trial. */
export const SoloCellText = "—";

/**
 * The header fields THIS pane renders an inline issue under. Every name here is
 * one `validateSessionDesign` actually emits; there is deliberately no
 * "groupSize" or "startProgress", because no rule produces one.
 */
export const ScheduleFields = [
  "pattern",
  "trials",
  "trialRoutine",
  "interTrialRoutine",
  "conditions",
] as const;

export type ScheduleField = (typeof ScheduleFields)[number];

/**
 * The fields Task 4's CohortPanel renders in the left rail. Listed here only so
 * this pane does not banner an issue that is already shown, in place, there.
 *
 * No "strategy" entry: `validateSessionDesign` never emits one — the
 * filterless-seat rule already files per-seat as `seats.<i>` — and
 * `CohortPanel` was likewise never given a matcher for it, so the two files
 * agree there is nothing here to place.
 */
export const CohortFields = ["cohortSize", "seats", "partnerUnavailableText"] as const;

/** `validateSessionDesign` files a per-trial table error as `pattern.steps.<0-based index>`. */
export const StepFieldPrefix = "pattern.steps.";
/** …and a per-seat filter error as `seats.<0-based index>`, rendered by the rail. */
export const SeatFieldPrefix = "seats.";

export function patternKindOf(pattern: InteractionPattern | undefined): PatternKind {
  return pattern?.type ?? "round-robin";
}

/**
 * The group size a pattern implies, for the Group size select. Only
 * `round-robin` stores it; the others are read back off their groups so
 * switching pattern does not silently reset the select to dyads.
 */
export function groupSizeOf(pattern: InteractionPattern | undefined): number {
  if (pattern?.type === "round-robin") return pattern.groupSize;
  if (pattern?.type === "fixed") return pattern.groups[0]?.length ?? DefaultGroupSize;
  if (pattern?.type === "sequence") return pattern.steps[0]?.[0]?.length ?? DefaultGroupSize;
  return DefaultGroupSize;
}

/**
 * Group sizes that divide the cohort evenly. A size equal to the cohort puts
 * everyone in one group — that is the `all` pattern, not a rotation — so it is
 * offered only when nothing smaller divides the cohort (2, 5, 7 seats).
 */
export function groupSizeOptions(cohortSize: number): number[] {
  const divisors: number[] = [];
  for (let size = DefaultGroupSize; size <= cohortSize; size++) {
    if (cohortSize % size === 0) divisors.push(size);
  }
  const proper = divisors.filter((size) => size < cohortSize);
  return proper.length > 0 ? proper : divisors;
}

/**
 * How a group of this size is named, in prose. THE single source of group-size
 * wording in the app: the Group size select uses it through `groupSizeLabel`,
 * and the ApplyBar's plan sentence imports it directly, so one screen can never
 * word the same number two ways.
 */
export function groupSizeName(groupSize: number): string {
  if (groupSize === 2) return "dyads";
  if (groupSize === 3) return "triads";
  return `groups of ${groupSize}`;
}

export function groupSizeLabel(groupSize: number): string {
  return `${groupSize} — ${groupSizeName(groupSize)}`;
}

/**
 * A full round-robin over N seats is N-1 trials — the number of rotations
 * `computeRoundRobinRotations` returns. Anything more wraps modulo and repeats
 * pairs, which `validateSessionDesign` blocks.
 */
export function fullRoundRobinTrials(cohortSize: number): number {
  return Math.max(MinTrials, cohortSize - 1);
}

export function isFullRoundRobin(
  pattern: InteractionPattern | undefined,
  trials: number,
  cohortSize: number,
): boolean {
  return pattern?.type === "round-robin" && trials === fullRoundRobinTrials(cohortSize);
}

/**
 * Routine names offered by a routine select. A selection that matches no
 * routine (renamed or deleted in the Builder) is appended rather than dropped,
 * so the select never silently rewrites the design.
 */
export function routineOptions(
  routines: Pick<RoutineConfig, "name" | "type">[],
  type: RoutineType,
  selected: string | null,
): string[] {
  const names = routines.filter((r) => r.type === type).map((r) => r.name);
  if (selected && !names.includes(selected)) names.push(selected);
  return names;
}

/**
 * Routine names the Between-trials select offers. Any routine can run between
 * trials EXCEPT the block's own matching routines — a between-trials routine
 * that re-opens matching would re-match every seat instead of advancing to the
 * next scheduled pairing.
 */
export function interTrialRoutineOptions(
  routines: Pick<RoutineConfig, "name" | "type">[],
): string[] {
  return routines
    .filter((r) => r.type !== "routine-matching" && r.type !== "routine-end-matching")
    .map((r) => r.name);
}

/**
 * Progresses consumed per trial: one for the trial itself, plus one for the
 * between-trials routine when it is set. `compileSessionDesign` places trial k
 * (1-based) at `startProgress + 1 + (k - 1) * stride` using exactly this
 * number, and Task 6's ExplicitPairingTable imports this function rather than
 * re-deriving it — the whole point of the compile step is that the preview and
 * the emitted rows cannot disagree about which progress a trial runs at.
 */
export function progressStride(interTrialRoutine: string | null): number {
  return interTrialRoutine ? 2 : 1;
}

export interface ScheduleColumn {
  trial: number;
  label: string;
  progress: number;
  progressLabel: string;
}

export interface ScheduleRow {
  seat: number;
  label: string;
  cells: string[];
}

export interface ScheduleGrid {
  columns: ScheduleColumn[];
  rows: ScheduleRow[];
}

/**
 * The seats × trials grid. One column per step actually scheduled — not per
 * `design.trials` — so an under-authored explicit table shows as fewer columns
 * rather than as columns the runtime will never reach.
 *
 * `startProgress` is the matching routine's progress; trials begin one after it.
 */
export function buildScheduleGrid(
  steps: number[][][],
  cohortSize: number,
  startProgress: number,
  interTrialRoutine: string | null,
): ScheduleGrid {
  const stride = progressStride(interTrialRoutine);

  const columns = steps.map((_, index) => {
    const trial = index + 1;
    const progress = startProgress + 1 + index * stride;
    return { trial, label: `T${trial}`, progress, progressLabel: `p${progress}` };
  });

  const rows = Array.from({ length: cohortSize }, (_, seat) => ({
    seat,
    label: `Seat ${seat + 1}`,
    cells: steps.map((groups) => {
      const group = groups.find((g) => g.includes(seat)) ?? [];
      const partners = group.filter((member) => member !== seat);
      return partners.length > 0 ? partners.map((s) => s + 1).join(", ") : SoloCellText;
    }),
  }));

  return { columns, rows };
}

const cloneGroups = (groups: number[][]): number[][] => groups.map((g) => [...g]);

/**
 * The patch a Pattern select change emits. Switching to an explicit table or
 * fixed groups seeds them from the steps currently on screen, so the researcher
 * edits a known-good baseline instead of an empty table. Seeded arrays are
 * cloned — the design must not alias the `steps` prop.
 */
export function patternPatch(
  kind: PatternKind,
  groupSize: number,
  steps: number[][][],
): { pattern: InteractionPattern } {
  if (kind === "round-robin") return { pattern: { type: "round-robin", groupSize } };
  if (kind === "sequence") {
    return { pattern: { type: "sequence", steps: steps.map(cloneGroups) } };
  }
  if (kind === "fixed") {
    return { pattern: { type: "fixed", groups: cloneGroups(steps[0] ?? []) } };
  }
  return { pattern: { type: "all" } };
}

/**
 * The patch a Group size select change emits. It PRESERVES the pattern kind:
 * hard-coding "round-robin" here would silently convert an authored explicit
 * table and throw away `pattern.steps` the moment a researcher touched a select
 * that, for that kind, should change nothing. Re-pinning the trial count is
 * likewise limited to a round-robin, the only pattern whose trial count is a
 * function of the group size.
 */
export function groupSizePatch(
  kind: PatternKind,
  groupSize: number,
  steps: number[][][],
  cohortSize: number,
  pinFullRoundRobin: boolean,
): Partial<SessionDesign> {
  const patch = patternPatch(kind, groupSize, steps);
  if (kind !== "round-robin" || !pinFullRoundRobin) return patch;
  return { ...patch, trials: fullRoundRobinTrials(cohortSize) };
}

/**
 * The patch the Trials input emits, or null when the field is mid-edit — an
 * emptied number input yields NaN, and clearing it must not wipe the schedule.
 * An over-long round-robin is reported by `validateSessionDesign`, not clamped
 * here, so the researcher sees why the number is refused.
 */
export function trialsPatch(count: number): { trials: number } | null {
  if (!Number.isInteger(count) || count < MinTrials) return null;
  return { trials: count };
}

/**
 * Issues rendered under one header control. Exact match, so a
 * `pattern.steps.<i>` row error is NOT swallowed by the Pattern select — it
 * belongs beside the table row that caused it, which `issuesForStep` supplies.
 */
export function issuesForField(
  issues: SessionDesignIssue[],
  field: string,
): SessionDesignIssue[] {
  return issues.filter((issue) => issue.field === field);
}

/** Issues belonging to one row of the explicit pairing table. `trialIndex` is 0-based. */
export function issuesForStep(
  issues: SessionDesignIssue[],
  trialIndex: number,
): SessionDesignIssue[] {
  return issuesForField(issues, `${StepFieldPrefix}${trialIndex}`);
}

const placedFields = new Set<string>([...ScheduleFields, ...CohortFields]);

/**
 * Issues naming no field at all, or a field no control anywhere owns
 * (block-level problems). They are banner-rendered so no validation result is
 * silently dropped between panes. Prefixed fields are matched by prefix:
 * `pattern.steps.<i>` sits on its table row and `seats.<i>` sits on its seat in
 * the cohort rail, so neither is duplicated into a banner.
 */
export function unplacedIssues(issues: SessionDesignIssue[]): SessionDesignIssue[] {
  return issues.filter((issue) => {
    if (!issue.field) return true;
    if (placedFields.has(issue.field)) return false;
    if (issue.field.startsWith(StepFieldPrefix)) return false;
    if (issue.field.startsWith(SeatFieldPrefix)) return false;
    return true;
  });
}
