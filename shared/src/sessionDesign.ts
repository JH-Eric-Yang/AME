import {
  computeRoundRobinRotations,
  MinimumGroupSize,
  MinimumSeatCount,
  validateRotation,
} from "./interactionGroups.js";
import { getDefaultLayout } from "./defaultLayouts.js";
import { GeneratedDescriptionPrefix } from "./contentValidation.js";
import type {
  InteractionPattern,
  MatchingSlot,
  RoleAssignment,
  RoutineConfig,
} from "./types.js";

export type { RoutineConfig } from "./types.js";

/** The canonical study: eight participants swapping partners in dyads. */
const DefaultCohortSize = 8;
/** Dyads — the pattern every motivating study in the design doc uses. */
const DefaultGroupSize = 2;
/** Five minutes. `MatchingConfig.timeout` is in SECONDS everywhere. */
const DefaultTimeoutSeconds = 300;
/** The condition name `ExperimentContent.condition` defaults to. */
const DefaultConditionName = "Basic";
/** Used when the Builder holds no video-chat routine to name the block after. */
const DefaultTrialRoutineName = "Chat";
const DefaultPartnerUnavailableText =
  "Your partner is no longer available. Please continue on your own.";
/**
 * Leading word of a block id (`block-<8 chars>`).
 *
 * The marker stamped on a compiled ROW is a different string — it carries the
 * separating colon — and is imported from `contentValidation` rather than
 * spelled again here. `replaceContent` deletes a block's rows by that prefix,
 * so a second copy that drifted from it would make the delete match nothing
 * and every re-apply would silently double the block's content rows.
 */
const BlockIdPrefix = "block";
/** Progress rows one trial occupies when a between-trials routine follows it. */
const StrideWithInterTrialRoutine = 2;
/** Progress rows one trial occupies on its own. */
const StrideWithoutInterTrialRoutine = 1;
/**
 * No plausible study runs more trials than this; a larger figure is a typo.
 *
 * The clamp is what keeps a stray digit from throwing `RangeError: Invalid
 * array length` out of `Array.from({ length })` — which, because the validator
 * compiles the design to read its band, would take down the very apply bar
 * that was about to report the over-long schedule.
 */
const MaxScheduleTrials = 500;
/**
 * The largest cohort a block will schedule.
 *
 * A round-robin over N seats materialises O(N²) group arrays, and the coverage
 * rule below has to build the schedule to measure it. Without a clamp, a stray
 * digit in `cohortSize` would hang the very validator that was about to report
 * it — the same failure `MaxScheduleTrials` guards for the trial count. No
 * video-chat study runs a cohort anywhere near this.
 */
const MaxCohortSize = 200;
/** Characters of a block id, taken from a UUID or from the random fallback. */
const BlockIdLength = 8;
/** A seat assigned exactly twice reads better as "twice" than as "2 times". */
const SeatAssignedTwice = 2;
/**
 * Cohort sizes spelled out for the approved blocking copy in
 * design/ApplyStates.dc.html ("…would quietly put all seven in one call").
 * Anything larger falls back to digits.
 */
const SpelledNumbers: Record<number, string> = {
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
  7: "seven",
  8: "eight",
  9: "nine",
  10: "ten",
  11: "eleven",
  12: "twelve",
};

/**
 * One authored rotating-video-chat block.
 *
 * Seats are 0-based here and in every stored payload; the 1-based numbers the
 * researcher sees exist only inside `parseSeatGroups` / `formatSeatGroups`.
 * `cohortSize` is authoritative for the rotation and `seats` for the matching
 * slots, so `validateSessionDesign` blocks any design where they disagree.
 */
export interface SessionDesign {
  version: 1;
  id: string;
  label: string;
  cohortSize: number;
  strategy: "fifo" | "property" | "manual";
  timeoutSeconds: number;
  timeoutAction: "proceed" | "wait";
  seats: MatchingSlot[];
  /**
   * How each session's role indices are dealt. Absent means the default,
   * `{ mode: "random" }` — the same default a hand-authored matching routine
   * carries. It is held on the design, not only on the compiled routine,
   * because re-applying the block replaces that routine wholesale and would
   * otherwise discard whatever the researcher had chosen.
   */
  assignment?: RoleAssignment;
  pattern: InteractionPattern;
  trials: number;
  trialRoutine: string;
  interTrialRoutine: string | null;
  conditions: string[];
  startProgress: number;
  matchRoutineName: string;
  endMatchRoutineName: string;
  partnerUnavailableText: string;
  /** Keyed by 1-based trial number; becomes the row's `content` JSON. */
  trialContent: Record<number, Record<string, unknown>>;
}

/** One `ExperimentContent` row, ready for the content upload route. */
export interface CompiledContentRow {
  progress: number;
  trialNumber: number;
  routine: string;
  condition: string;
  content: Record<string, unknown>;
  description: string;
}

/**
 * Everything one block writes. `routines` is create-or-replace by name: the
 * block owns all three, and Builder edits are surfaced by `diffCompiled`
 * rather than merged silently.
 */
export interface CompiledBlock {
  routines: RoutineConfig[];
  contentRows: CompiledContentRow[];
  band: {
    fromProgress: number;
    toProgress: number;
    conditions: string[];
    blockId: string;
  };
  participantsPerSession: number;
}

/**
 * The fixed vocabulary of `SessionDesignIssue.field`.
 *
 * Each panel of the Session Designer renders the issues whose field it owns,
 * beside the control that causes them — so this list is a contract, not a
 * hint. `seats.` and `pattern.steps.` are matched by PREFIX, so a per-seat or
 * per-row issue lands on its own row.
 */
export type SessionDesignField =
  | "cohortSize"
  | "strategy"
  | "seats"
  | `seats.${number}`
  | "pattern"
  | `pattern.steps.${number}`
  | "trials"
  | "trialRoutine"
  | "interTrialRoutine"
  | "conditions"
  | "partnerUnavailableText";

/**
 * One reason a design is not applicable, or a caution about it.
 *
 * Every `level: "error"` message is TWO sentences — the failure, then the
 * remedy — because the apply bar splits on the first ". " and renders the
 * halves as headline and detail (design/ApplyStates.dc.html).
 *
 * `field` is one of `SessionDesignField`; it is typed as a plain string so
 * consumers can compare freely, but this module emits nothing else.
 */
export interface SessionDesignIssue {
  level: "error" | "warning";
  message: string;
  field?: string;
}

/** One authored content row, as far as the block-band checks care. */
export interface BandContentRow {
  progress: number;
  routine: string;
}

/** One disagreement between a compiled block and what the Builder now holds. */
export interface DriftEntry {
  routineName: string;
  field: string;
  message: string;
}

/**
 * Entropy for a block id when `crypto.randomUUID` is unavailable — which is
 * every plain-http origin, including the LAN host this project serves device
 * pairing from. Two draws so the string is never short of `BlockIdLength`;
 * a timestamp is deliberately NOT used, because two blocks added in the same
 * millisecond would then share an id.
 */
const randomIdSuffix = (): string =>
  `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

const newBlockId = (): string => {
  const random = globalThis.crypto?.randomUUID?.() ?? randomIdSuffix();
  return `${BlockIdPrefix}-${random.slice(0, BlockIdLength)}`;
};

/** "1 seat" / "8 seats" — used in copy that must read as a sentence. */
const countOfSeats = (count: number): string =>
  `${count} seat${count === 1 ? "" : "s"}`;

/** "1 trial" / "7 trials". */
const countOfTrials = (count: number): string =>
  `${count} trial${count === 1 ? "" : "s"}`;

/** "1 unique rotation" / "7 unique rotations". */
const countOfRotations = (count: number): string =>
  `${count} unique rotation${count === 1 ? "" : "s"}`;

/** "1 pair" / "12 pairs". */
const countOfPairs = (count: number): string =>
  `${count} pair${count === 1 ? "" : "s"}`;

/** "1 repeat pairing" / "48 repeat pairings" — a pair meeting more than once. */
const countOfRepeatPairings = (count: number): string =>
  `${count} repeat pairing${count === 1 ? "" : "s"}`;

/** "seat 4" / "seats 4, 6" — the subject of a seat-coverage complaint. */
const seatList = (seats: number[]): string =>
  `seat${seats.length === 1 ? "" : "s"} ${seats.join(", ")}`;

const spellCount = (count: number): string => SpelledNumbers[count] ?? String(count);

/**
 * A ready-to-edit design for the experiment as it stands: the canonical
 * 8-seat round-robin, or the seats of an existing matching routine when the
 * Builder already has one.
 *
 * @param lastProgress the highest progress already authored; the block starts
 *   at the next one.
 */
export function defaultSessionDesign(
  routines: RoutineConfig[],
  conditions: string[],
  lastProgress: number,
): SessionDesign {
  const existing = routines.find(
    (routine) => (routine.matching?.slots.length ?? 0) >= MinimumSeatCount,
  )?.matching;
  const seats = existing
    ? structuredClone(existing.slots)
    : Array.from({ length: DefaultCohortSize }, (_, index) => ({
        name: `seat-${index + 1}`,
      }));
  const cohortSize = seats.length;
  const trialRoutine =
    routines.find((routine) => routine.type === "routine-video-chat")?.name ??
    DefaultTrialRoutineName;

  return {
    version: 1,
    id: newBlockId(),
    label: `${trialRoutine} block`,
    cohortSize,
    strategy: existing?.strategy ?? "fifo",
    timeoutSeconds: existing?.timeout ?? DefaultTimeoutSeconds,
    timeoutAction: existing?.timeoutAction ?? "wait",
    seats,
    pattern: { type: "round-robin", groupSize: DefaultGroupSize },
    trials: cohortSize - 1,
    trialRoutine,
    interTrialRoutine: null,
    conditions: conditions.length > 0 ? [...conditions] : [DefaultConditionName],
    startProgress: lastProgress + 1,
    matchRoutineName: `${trialRoutine}-match`,
    endMatchRoutineName: `${trialRoutine}-end-match`,
    partnerUnavailableText: DefaultPartnerUnavailableText,
    trialContent: {},
  };
}

/** A fresh copy of one trial's groups, so no two trials share an array. */
const cloneStep = (groups: number[][]): number[][] => groups.map((group) => [...group]);

/**
 * How many trials this design runs, without building any of them.
 *
 * An explicit table's own length wins over `design.trials`; every other pattern
 * is the authored count, truncated, floored at zero and capped at
 * `MaxScheduleTrials`. `Math.trunc(NaN)` is NaN, and `Math.max(0, NaN)` is NaN,
 * so a blank input degrades to an empty schedule rather than throwing.
 */
const scheduleLength = (design: SessionDesign): number =>
  design.pattern.type === "sequence"
    ? design.pattern.steps.length
    : Math.min(MaxScheduleTrials, Math.max(0, Math.trunc(design.trials)));

/**
 * The interaction groups this design produces, one entry per trial.
 *
 * Round-robin wraps modulo the available rotations exactly as
 * `getInteractionGroup` does at runtime, so an over-authored schedule shows up
 * as repeats in the coverage matrix instead of hiding behind clean-looking
 * rows. A `sequence` table is reproduced faithfully — it *is* the schedule.
 *
 * Every group array is freshly cloned, and no two trials share one. The
 * explicit-table and schedule-grid editors start from this array and let a
 * researcher edit a single row; without the clone, editing trial 2 would also
 * edit trials 1 and 3, or write straight through into `design.pattern`.
 */
export function stepsForDesign(design: SessionDesign): number[][][] {
  const { pattern } = design;
  if (pattern.type === "sequence") return pattern.steps.map(cloneStep);

  const trialCount = scheduleLength(design);

  if (pattern.type === "round-robin") {
    const rotations = computeRoundRobinRotations(design.cohortSize, pattern.groupSize);
    return Array.from({ length: trialCount }, (_, index) =>
      cloneStep(rotations[index % rotations.length]),
    );
  }

  if (pattern.type === "fixed") {
    return Array.from({ length: trialCount }, () => cloneStep(pattern.groups));
  }

  const everyone = Array.from({ length: design.cohortSize }, (_, seat) => seat);
  return Array.from({ length: trialCount }, () => [[...everyone]]);
}

/**
 * The progress range this design occupies, by arithmetic alone.
 *
 * `compileSessionDesign` and `validateSessionDesign` both read the band, but
 * the validator wants only these two integers — compiling to get them
 * materialises and deep-clones a row per trial per condition on every keystroke
 * of the Session Designer.
 */
export function progressBand(design: SessionDesign): {
  fromProgress: number;
  toProgress: number;
} {
  const trialCount = scheduleLength(design);
  const stride = design.interTrialRoutine
    ? StrideWithInterTrialRoutine
    : StrideWithoutInterTrialRoutine;

  // The last trial never carries a between-trials row, so the last row before
  // the end-match is always the final trial itself.
  const lastRowProgress =
    trialCount === 0
      ? design.startProgress
      : design.startProgress + 1 + (trialCount - 1) * stride;

  return { fromProgress: design.startProgress, toProgress: lastRowProgress + 1 };
}

/**
 * Who meets whom, and when.
 *
 * `pairs` is keyed `"<lowSeat>-<highSeat>"` with 0-based seats; each value
 * lists the 1-based trials on which that pair shares a group.
 */
export function coverageMatrix(
  steps: number[][][],
  cohortSize: number,
): { pairs: Map<string, number[]>; total: number; met: number; repeats: number } {
  const pairs = new Map<string, number[]>();

  steps.forEach((groups, index) => {
    const trial = index + 1;
    for (const group of groups) {
      const seats = [...group].sort((a, b) => a - b);
      for (let a = 0; a < seats.length; a++) {
        for (let b = a + 1; b < seats.length; b++) {
          const key = `${seats[a]}-${seats[b]}`;
          const hits = pairs.get(key);
          if (hits) hits.push(trial);
          else pairs.set(key, [trial]);
        }
      }
    }
  });

  let repeats = 0;
  for (const hits of pairs.values()) repeats += hits.length - 1;

  return {
    pairs,
    total: (cohortSize * (cohortSize - 1)) / 2,
    met: pairs.size,
    repeats,
  };
}

/** 0-based groups → the 1-based text a researcher types, e.g. "1-8, 2-7". */
export function formatSeatGroups(groups: number[][]): string {
  return groups
    .map((group) => group.map((seat) => seat + 1).join("-"))
    .join(", ");
}

/**
 * The 1-based text a researcher types → 0-based groups, with every reason the
 * line is not a valid trial. Groups are returned best-effort even when issues
 * are present, so the editor can still render what was understood.
 *
 * A chunk that failed to parse is NOT then also reported as a lonely seat:
 * "1-9" in a cohort of 8 is one complaint about seat 9, not a second one about
 * seat 1. The `chunkFailed` flag is what keeps the two apart.
 *
 * Callers that split these into blocking versus coverage complaints must match
 * on the FULL phrases — `"is not a seat number"` (blocking) and
 * `"is not assigned"` (coverage) share the prefix `"is not a"`, so a naive
 * `includes("is not a")` silently classifies every unassigned seat as a parse
 * failure. The blocking phrases are `"is not a seat number"`, `"is outside the
 * cohort"` and `"has no partner"`; the coverage ones are `"appears N times"`
 * and `"is not assigned"`.
 */
export function parseSeatGroups(
  text: string,
  cohortSize: number,
): { groups: number[][]; issues: string[] } {
  const issues: string[] = [];
  const groups: number[][] = [];
  const seen = new Map<number, number>();

  const chunks = text
    .split(",")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  for (const chunk of chunks) {
    const group: number[] = [];
    let chunkFailed = false;

    for (const token of chunk.split("-").map((part) => part.trim())) {
      const seat = Number(token);
      if (token.length === 0 || !Number.isInteger(seat)) {
        issues.push(`"${token}" is not a seat number in "${chunk}"`);
        chunkFailed = true;
        continue;
      }
      if (seat < 1 || seat > cohortSize) {
        issues.push(`Seat ${seat} is outside the cohort of ${cohortSize}`);
        chunkFailed = true;
        continue;
      }
      seen.set(seat, (seen.get(seat) ?? 0) + 1);
      group.push(seat - 1);
    }

    if (!chunkFailed && group.length === 1) {
      issues.push(`Seat ${group[0] + 1} has no partner`);
    }
    if (group.length > 0) groups.push(group.sort((a, b) => a - b));
  }

  for (const [seat, count] of seen) {
    if (count > 1) issues.push(`Seat ${seat} appears ${count} times`);
  }
  for (let seat = 1; seat <= cohortSize; seat++) {
    if (!seen.has(seat)) issues.push(`Seat ${seat} is not assigned`);
  }

  return { groups, issues };
}

/**
 * Emit the block's routines and its content rows from one pass over one
 * schedule, so the number of rotations and the number of rows cannot disagree.
 * The row count follows `stepsForDesign`, never `design.trials` directly.
 *
 * Progress arithmetic (the client's schedule grid and explicit table must use
 * the same rule): the match row sits at `startProgress`; trial k sits at
 * `startProgress + 1 + (k - 1) * stride`, where `stride` is 2 when a
 * between-trials routine is set and 1 otherwise; the between-trials row sits
 * one progress after its trial and is emitted only BETWEEN trials, never after
 * the last one; the end-match row is the last progress plus one.
 *
 * The trial routine compiles with `matching: null` on purpose: a trial routine
 * carrying its own matching re-matches every trial and pins the rotation index
 * to zero.
 */
export function compileSessionDesign(design: SessionDesign): CompiledBlock {
  const steps = stepsForDesign(design);
  const stride = design.interTrialRoutine
    ? StrideWithInterTrialRoutine
    : StrideWithoutInterTrialRoutine;

  const matchRoutine: RoutineConfig = {
    name: design.matchRoutineName,
    type: "routine-matching",
    layout: getDefaultLayout("routine-matching"),
    elements: [],
    matching: {
      strategy: design.strategy,
      slots: structuredClone(design.seats),
      timeout: design.timeoutSeconds,
      timeoutAction: design.timeoutAction,
      // Only when the design carries one, so a block that never chose leaves
      // no `assignment` key and the runtime default governs — the same shape a
      // routine authored before this field had.
      ...(design.assignment ? { assignment: structuredClone(design.assignment) } : {}),
    },
  };

  const trialRoutine: RoutineConfig = {
    name: design.trialRoutine,
    type: "routine-video-chat",
    layout: getDefaultLayout("routine-video-chat"),
    elements: [],
    matching: null,
    interactionPattern: structuredClone(design.pattern),
    config: { partnerUnavailableText: design.partnerUnavailableText },
  };

  const endRoutine: RoutineConfig = {
    name: design.endMatchRoutineName,
    type: "routine-end-matching",
    layout: getDefaultLayout("routine-end-matching"),
    elements: [],
    matching: null,
  };

  // Lay the band out once, then repeat it verbatim for every condition, so
  // members of a session on different conditions share a progress map.
  type RowTemplate = Omit<CompiledContentRow, "condition" | "description">;
  const templates: RowTemplate[] = [];
  const matchProgress = design.startProgress;

  templates.push({
    progress: matchProgress,
    trialNumber: 1,
    routine: design.matchRoutineName,
    content: {},
  });

  steps.forEach((_, index) => {
    const trialNumber = index + 1;
    const trialProgress = matchProgress + 1 + index * stride;

    templates.push({
      progress: trialProgress,
      trialNumber,
      routine: design.trialRoutine,
      content: design.trialContent[trialNumber] ?? {},
    });

    if (design.interTrialRoutine && trialNumber < steps.length) {
      templates.push({
        progress: trialProgress + 1,
        trialNumber,
        routine: design.interTrialRoutine,
        content: {},
      });
    }
  });

  const band = progressBand(design);
  templates.push({
    progress: band.toProgress,
    trialNumber: 1,
    routine: design.endMatchRoutineName,
    content: {},
  });

  const contentRows: CompiledContentRow[] = [];
  for (const condition of design.conditions) {
    for (const template of templates) {
      contentRows.push({
        ...template,
        condition,
        content: structuredClone(template.content),
        description: `${GeneratedDescriptionPrefix}${design.id}:${contentRows.length}`,
      });
    }
  }

  return {
    routines: [matchRoutine, trialRoutine, endRoutine],
    contentRows,
    band: {
      ...band,
      conditions: [...design.conditions],
      blockId: design.id,
    },
    participantsPerSession: design.cohortSize,
  };
}

/**
 * `validateRotation` returns "Cohort of 7 cannot be split into groups of 2";
 * the approved copy in design/ApplyStates.dc.html reads "A cohort of 7 …".
 */
const withArticle = (sentence: string): string =>
  `A ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`;

/**
 * The remedy half of the rotation message. The branches mirror
 * `validateRotation`'s own order so the advice matches the failure; the
 * divisibility wording is the approved copy and is reproduced verbatim.
 */
const rotationRemedy = (cohortSize: number, groupSize: number): string => {
  const consequence = `Left alone, the schedule would quietly put all ${spellCount(cohortSize)} in one call.`;
  if (cohortSize < MinimumSeatCount) {
    return `Add seats until the cohort can form a group. ${consequence}`;
  }
  if (groupSize < MinimumGroupSize) {
    return `Raise the group size to at least ${MinimumGroupSize}. ${consequence}`;
  }
  if (groupSize > cohortSize) {
    return `Lower the group size to at most the cohort size, or add seats. ${consequence}`;
  }
  return `Use an even cohort, or a group size that divides it. ${consequence}`;
};

/**
 * Every way one trial's groups fail to assign each seat exactly once, as
 * clauses ready to join with "; ". An empty array means the trial is sound.
 *
 * Shared so that a guard over a `fixed` pattern's groups — which are one trial
 * repeated — is a call rather than a re-implementation of the same arithmetic.
 */
const seatCoverageIssues = (groups: number[][], cohortSize: number): string[] => {
  const counts = new Map<number, number>();
  for (const group of groups) {
    for (const seat of group) counts.set(seat, (counts.get(seat) ?? 0) + 1);
  }

  const missing: number[] = [];
  for (let seat = 0; seat < cohortSize; seat++) {
    if (!counts.has(seat)) missing.push(seat + 1);
  }
  const outOfRange = [...counts.keys()]
    .filter((seat) => seat < 0 || seat >= cohortSize)
    .map((seat) => seat + 1);

  // Grouped by how often each seat repeats, so three appearances never read as
  // "assigned twice".
  const repeatedByCount = new Map<number, number[]>();
  for (const [seat, count] of counts) {
    if (count <= 1) continue;
    const seats = repeatedByCount.get(count);
    if (seats) seats.push(seat + 1);
    else repeatedByCount.set(count, [seat + 1]);
  }

  const parts: string[] = [];
  if (missing.length > 0) parts.push(`${seatList(missing)} unassigned`);
  for (const [count, seats] of [...repeatedByCount].sort(([a], [b]) => a - b)) {
    parts.push(
      count === SeatAssignedTwice
        ? `${seatList(seats)} assigned twice`
        : `${seatList(seats)} assigned ${count} times`,
    );
  }
  if (outOfRange.length > 0) parts.push(`${seatList(outOfRange)} outside the cohort`);

  return parts;
};

/**
 * Every reason this design must not be applied, plus non-blocking warnings.
 *
 * Each blocking message is two sentences — the failure, then the remedy — so
 * the apply bar can split it on the first ". " into headline and detail.
 *
 * @param bandContent the experiment's authored content rows, so a rotating
 *   routine placed inside this block's progress band by hand is caught too.
 *   Optional: callers that have no rows yet pass nothing.
 */
export function validateSessionDesign(
  design: SessionDesign,
  routines: RoutineConfig[],
  conditions: string[],
  bandContent: BandContentRow[] = [],
): SessionDesignIssue[] {
  const issues: SessionDesignIssue[] = [];
  const error = (message: string, field: SessionDesignField) =>
    issues.push({ level: "error", message, field });

  if (design.seats.length < MinimumSeatCount) {
    error(
      `A cohort of ${countOfSeats(design.seats.length)} cannot form an interaction group. Add at least ${MinimumSeatCount} seats to the cohort, or delete this block.`,
      "seats",
    );
  }

  // The editor keeps these equal, but a hand-written or imported design can
  // compile a 4-slot matching routine against an 8-seat rotation.
  if (design.cohortSize !== design.seats.length) {
    error(
      `This block declares a cohort of ${design.cohortSize} but lists ${countOfSeats(design.seats.length)}. Set both to the same number; otherwise the matching routine opens ${countOfSeats(design.seats.length)} for a ${design.cohortSize}-seat rotation and the surplus seats pair with nobody.`,
      "cohortSize",
    );
  }

  if (design.cohortSize > MaxCohortSize) {
    error(
      `A cohort of ${design.cohortSize} is larger than the ${MaxCohortSize} seats a session block can schedule. Reduce it to ${MaxCohortSize} or fewer; a rotation over that many seats is a mistyped figure, not a study, and building its schedule would stall the experiment.`,
      "cohortSize",
    );
  }

  // Guarded by the clamp above: everything past this point may BUILD the
  // schedule to measure it, which is quadratic in the cohort size.
  if (design.pattern.type === "round-robin" && design.cohortSize <= MaxCohortSize) {
    const { groupSize } = design.pattern;
    const rotationError = validateRotation(design.cohortSize, groupSize);
    if (rotationError) {
      error(
        `${withArticle(rotationError)}. ${rotationRemedy(design.cohortSize, groupSize)}`,
        "cohortSize",
      );
    } else if (groupSize > MinimumGroupSize) {
      // Above dyads there is no complete rotation to count:
      // `computeRoundRobinRotations` slices the rotated circle into consecutive
      // chunks, which is not a resolvable design, and a complete one does not
      // exist for every cohort at all (Kirkman/Steiner). So the schedule is not
      // predicted from the cohort size — it is built and its coverage measured,
      // and anything short of "every pair exactly once" is refused rather than
      // shipped as a round-robin that is not one.
      const coverage = coverageMatrix(stepsForDesign(design), design.cohortSize);
      const unmet = coverage.total - coverage.met;
      if (unmet > 0 || coverage.repeats > 0) {
        const repeatClause =
          coverage.repeats > 0 ? `, and ${countOfRepeatPairings(coverage.repeats)}` : "";
        error(
          `A round-robin in groups of ${groupSize} does not cover a cohort of ${design.cohortSize}. Over ${countOfTrials(scheduleLength(design))} only ${coverage.met} of the ${coverage.total} possible pairs meet, leaving ${countOfPairs(unmet)} who never do${repeatClause}; use groups of 2, or write the trials out as an explicit schedule, because this block would otherwise run to completion and look clean while those pairs never happen.`,
          "pattern",
        );
      }
    } else {
      // Dyads only: the circle method gives exactly cohortSize-1 rotations that
      // between them cover every pair once, so the trial count IS the bound.
      const uniqueRotations = design.cohortSize - 1;
      if (design.trials > uniqueRotations) {
        const verb = design.trials === 1 ? "trial exceeds" : "trials exceed";
        error(
          `${design.trials} ${verb} the ${countOfRotations(uniqueRotations)} a cohort of ${design.cohortSize} has. Reduce the schedule to ${countOfTrials(uniqueRotations)}, or grow the cohort; left alone it wraps to the first rotation and the same pairs meet twice.`,
          "trials",
        );
      } else if (design.trials < uniqueRotations) {
        // A deliberately short schedule is supported — the designer has a "full
        // round-robin" tick to untick — so this says what the researcher gives
        // up rather than standing in the way.
        const coverage = coverageMatrix(stepsForDesign(design), design.cohortSize);
        issues.push({
          level: "warning",
          message: `This schedule runs ${countOfTrials(scheduleLength(design))} of the ${countOfRotations(uniqueRotations)} available, so ${coverage.met} of the ${coverage.total} pairs in the cohort meet and ${countOfPairs(coverage.total - coverage.met)} never do. Extend it to ${countOfTrials(uniqueRotations)} if every pair must meet.`,
          field: "trials",
        });
      }
    }
  }

  if (design.pattern.type === "sequence") {
    design.pattern.steps.forEach((groups, index) => {
      const parts = seatCoverageIssues(groups, design.cohortSize);
      if (parts.length === 0) return;

      error(
        `Trial ${index + 1} does not assign each of the ${design.cohortSize} seats exactly once (${parts.join("; ")}). Rewrite this row so every seat appears in exactly one group.`,
        `pattern.steps.${index}`,
      );
    });
  }

  const byName = new Map(routines.map((routine) => [routine.name, routine]));

  if (byName.get(design.trialRoutine)?.matching) {
    error(
      `Routine "${design.trialRoutine}" carries its own matching config. Clear it in the Builder and leave the matching on "${design.matchRoutineName}"; a trial routine that re-matches destroys the session and pins every trial to the first rotation.`,
      "trialRoutine",
    );
  }

  // `computeRotationIndex` counts EVERY round-robin routine between the match
  // progress and the current one, so any second rotating routine inside the
  // band double-advances the schedule — not only the declared inter-trial one.
  const band = progressBand(design);
  const rotatingCandidates = new Map<string, SessionDesignField>();
  if (design.interTrialRoutine) {
    rotatingCandidates.set(design.interTrialRoutine, "interTrialRoutine");
  }
  for (const name of [design.matchRoutineName, design.endMatchRoutineName]) {
    if (!rotatingCandidates.has(name)) rotatingCandidates.set(name, "pattern");
  }
  for (const row of bandContent) {
    if (row.progress < band.fromProgress || row.progress > band.toProgress) continue;
    if (!rotatingCandidates.has(row.routine)) rotatingCandidates.set(row.routine, "pattern");
  }

  for (const [name, field] of rotatingCandidates) {
    if (name === design.trialRoutine) continue;
    if (byName.get(name)?.interactionPattern?.type !== "round-robin") continue;
    error(
      `Routine "${name}" also rotates inside this block. Remove its round-robin pattern; two rotating routines in one trial advance the rotation index twice and break the pairing schedule.`,
      field,
    );
  }

  if (design.strategy === "property") {
    design.seats.forEach((seat, index) => {
      if (seat.filters && seat.filters.length > 0) return;
      error(
        `Seat ${index + 1} ("${seat.name}") has no property filters. Give it at least one filter, or switch the strategy to first-come-first-served; a property-matched seat that filters nothing accepts anyone.`,
        `seats.${index}`,
      );
    });
  }

  if (design.partnerUnavailableText.trim().length === 0) {
    error(
      "The dropout notice is blank. Give it text explaining that the participant's partner is no longer available; without it, an orphaned participant sees nothing at all when their partner drops.",
      "partnerUnavailableText",
    );
  }

  const known = conditions.length > 0 ? conditions : [DefaultConditionName];
  for (const condition of design.conditions) {
    if (known.includes(condition)) continue;
    issues.push({
      level: "warning",
      message: `Condition "${condition}" is not one of the experiment's conditions (${known.join(", ")}). Add it to the experiment, or pick one that exists; rows written under it would never be delivered.`,
      field: "conditions",
    });
  }

  return issues;
}

/** A stable key for comparing two patterns without depending on key order. */
const patternKey = (pattern: InteractionPattern | undefined): string => {
  if (!pattern) return "none";
  switch (pattern.type) {
    case "round-robin":
      return `round-robin:${pattern.groupSize}`;
    case "fixed":
      return `fixed:${JSON.stringify(pattern.groups)}`;
    case "sequence":
      return `sequence:${JSON.stringify(pattern.steps)}`;
    default:
      return "all";
  }
};

const describePattern = (pattern: InteractionPattern | undefined): string => {
  if (!pattern) return "no rotation";
  switch (pattern.type) {
    case "round-robin":
      return `round-robin in groups of ${pattern.groupSize}`;
    case "fixed":
      return `${pattern.groups.length} fixed groups`;
    case "sequence":
      return `an explicit table of ${pattern.steps.length} trials`;
    default:
      return "everyone together";
  }
};

/**
 * What the Builder now holds that this block does not agree with.
 *
 * The block owns three routines but the Builder can still edit them; rather
 * than locking those editors, the Session tab recompiles on open and reports
 * the differences so the researcher says which side is right.
 */
export function diffCompiled(
  compiled: CompiledBlock,
  routines: RoutineConfig[],
): DriftEntry[] {
  const live = new Map(routines.map((routine) => [routine.name, routine]));
  const entries: DriftEntry[] = [];

  for (const wanted of compiled.routines) {
    const current = live.get(wanted.name);
    if (!current) {
      entries.push({
        routineName: wanted.name,
        field: "routine",
        message: `${wanted.name} is not in the Builder; applying this block would create it.`,
      });
      continue;
    }

    if (current.type !== wanted.type) {
      entries.push({
        routineName: wanted.name,
        field: "type",
        message: `${wanted.name} is a ${current.type} in the Builder; this block needs a ${wanted.type}.`,
      });
    }

    const wantedSeats = wanted.matching?.slots.length ?? 0;
    const currentSeats = current.matching?.slots.length ?? 0;
    if (wantedSeats !== currentSeats) {
      entries.push({
        routineName: wanted.name,
        field: "matching.slots",
        message: `${wanted.name} has ${currentSeats} seats in the Builder; this block is designed for ${wantedSeats}.`,
      });
    }

    if (patternKey(current.interactionPattern) !== patternKey(wanted.interactionPattern)) {
      entries.push({
        routineName: wanted.name,
        field: "interactionPattern",
        message: `${wanted.name} is set to ${describePattern(current.interactionPattern)} in the Builder; this block is designed for ${describePattern(wanted.interactionPattern)}.`,
      });
    }
  }

  return entries;
}
