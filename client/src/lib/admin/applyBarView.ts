import type { InteractionPattern, RoutineConfig } from "ame-shared";
import type { CompiledBlock, SessionDesignIssue } from "ame-shared/sessionDesign";
import { groupSizeName } from "$lib/admin/rotationSchedule";

/** The apply lifecycle SessionDesignerTab tracks across the two writes. */
export type ApplyState = "idle" | "applying" | "applied" | "routines-only";

/** What the bar shows. `blocked` is `idle` with at least one error issue. */
export type ApplyStatus = "ready" | "blocked" | "applying" | "applied" | "routines-only";

export interface ApplyBarItem {
  /** `+` the block creates this routine, `~` it rewrites one the Builder already holds. */
  verb: "+" | "~";
  name: string;
  /** Parenthesised qualifier, or "" for a routine that needs none. */
  detail: string;
}

export interface ApplyBarAction {
  kind: "apply" | "view-content" | "retry-upload";
  label: string;
  disabled: boolean;
}

export interface ApplyBarView {
  status: ApplyStatus;
  items: ApplyBarItem[];
  summary: string;
  detail: string | null;
  action: ApplyBarAction;
}

const ApplyLabel = "Generate & Save";
const ApplyingLabel = "Saving…";
const ViewContentLabel = "View in Content";
const RetryUploadLabel = "Retry upload";

const RoutinesOnlySummary = "Routines saved — content upload failed.";
const RoutinesOnlyDetail =
  "The block's routines are on the experiment; its content rows are not. Nothing else was touched.";

/** Sentence boundary used to split a validator message into headline and remedy. */
const SentenceBreak = ". ";

/** The bar prints the FIRST error in full; the rest are only counted. */
const ShownErrorCount = 1;

/** Plain-words description of an interaction pattern, for the compile plan. */
export function describePattern(pattern: InteractionPattern | undefined): string {
  if (!pattern) return "no rotation";

  switch (pattern.type) {
    case "all":
      return "everyone together";
    case "fixed":
      return `fixed groups (${pattern.groups.length})`;
    case "round-robin":
      return `round-robin, ${groupSizeName(pattern.groupSize)}`;
    case "sequence":
      return `explicit table, ${pattern.steps.length} trials`;
  }
}

/**
 * Every blocking message is written as the failure, then the remedy. The bar
 * prints the first sentence loud and the rest quiet, so the failing rule reads
 * at a glance without losing the way out of it.
 */
export function splitIssueMessage(message: string): { headline: string; detail: string | null } {
  const boundary = message.indexOf(SentenceBreak);
  if (boundary === -1) return { headline: message, detail: null };

  return {
    headline: message.slice(0, boundary + 1),
    detail: message.slice(boundary + SentenceBreak.length).trim(),
  };
}

/**
 * `+` or `~` is a fact about the Builder, not a guess from the routine's type:
 * re-applying a block that already exists must not claim it is creating it.
 */
function planItem(routine: RoutineConfig, builderRoutineNames: string[]): ApplyBarItem {
  const verb = builderRoutineNames.includes(routine.name) ? "~" : "+";

  if (routine.type === "routine-matching") {
    const seats = routine.matching?.slots.length ?? 0;
    return { verb, name: routine.name, detail: `(routine-matching, ${seats} seats)` };
  }

  if (routine.interactionPattern) {
    return { verb, name: routine.name, detail: `(${describePattern(routine.interactionPattern)})` };
  }

  return { verb, name: routine.name, detail: "" };
}

function planSummary(compiled: CompiledBlock): string {
  const { band, contentRows, participantsPerSession } = compiled;

  const rows = `${contentRows.length} content ${contentRows.length === 1 ? "row" : "rows"}`;
  const progress =
    band.fromProgress === band.toProgress
      ? `progress ${band.fromProgress}`
      : `progress ${band.fromProgress}–${band.toProgress}`;
  const conditions =
    band.conditions.length === 1
      ? `condition ${band.conditions[0]}`
      : `conditions ${band.conditions.join(", ")}`;

  return `${rows}, ${progress}, ${conditions} · sets Participants Per Session to ${participantsPerSession}`;
}

/**
 * The quiet line under a blocking headline: the remedy from the shown error,
 * plus a count of the errors the bar has no room to print.
 */
function blockedDetail(errors: SessionDesignIssue[], remedy: string | null): string | null {
  const hidden = errors.length - ShownErrorCount;
  const extra =
    hidden > 0 ? `${hidden} more problem${hidden === 1 ? "" : "s"} must be fixed first.` : null;

  return [remedy, extra].filter((part): part is string => Boolean(part)).join(" ") || null;
}

/**
 * Turn a compiled block, its issues, the current apply state and the Builder's
 * routine names into everything ApplyBar.svelte renders. The four states of
 * design/ApplyStates.dc.html — READY, BLOCKED, APPLIED and PARTIAL FAILURE —
 * are four of the five shapes returned here; APPLYING is the fifth, a locked
 * READY shown only while the two writes are in flight.
 *
 * `inFlight` is the tab's own record of a running write, and it locks the
 * button whatever `state` says — see the note on the guard below.
 */
export function describeApplyBar(
  compiled: CompiledBlock,
  issues: SessionDesignIssue[],
  state: ApplyState,
  builderRoutineNames: string[],
  inFlight = false,
): ApplyBarView {
  const view = buildApplyBar(compiled, issues, state, builderRoutineNames);

  // A write already running outranks every state below. `state` cannot be
  // trusted for this: an edit made mid-write resets it to `idle`, so without
  // this the button would re-enable over a sequence still in flight and a
  // second press would race the first. "View in Content" is left alone — it
  // navigates, it does not write.
  if (!inFlight || view.action.kind === "view-content") return view;

  return { ...view, action: { ...view.action, label: ApplyingLabel, disabled: true } };
}

function buildApplyBar(
  compiled: CompiledBlock,
  issues: SessionDesignIssue[],
  state: ApplyState,
  builderRoutineNames: string[],
): ApplyBarView {
  if (state === "applied") {
    return {
      status: "applied",
      items: [],
      summary: `Applied · ${compiled.contentRows.length} rows written`,
      detail: null,
      action: { kind: "view-content", label: ViewContentLabel, disabled: false },
    };
  }

  if (state === "routines-only") {
    return {
      status: "routines-only",
      items: [],
      summary: RoutinesOnlySummary,
      detail: RoutinesOnlyDetail,
      action: { kind: "retry-upload", label: RetryUploadLabel, disabled: false },
    };
  }

  const items = compiled.routines.map((routine) => planItem(routine, builderRoutineNames));

  if (state === "applying") {
    return {
      status: "applying",
      items,
      summary: planSummary(compiled),
      detail: null,
      action: { kind: "apply", label: ApplyingLabel, disabled: true },
    };
  }

  const errors = issues.filter((issue) => issue.level === "error");
  if (errors.length > 0) {
    const { headline, detail } = splitIssueMessage(errors[0].message);
    return {
      status: "blocked",
      items: [],
      summary: headline,
      detail: blockedDetail(errors, detail),
      action: { kind: "apply", label: ApplyLabel, disabled: true },
    };
  }

  return {
    status: "ready",
    items,
    summary: planSummary(compiled),
    detail: null,
    action: { kind: "apply", label: ApplyLabel, disabled: false },
  };
}
