/**
 * "Adopt from Builder" — taking the Builder's live routines as the block's own.
 *
 * `diffCompiled` reports FOUR kinds of disagreement, and only two of them can
 * be resolved by copying a value back into the design:
 *
 * | drift field         | adoptable | why                                     |
 * |---------------------|-----------|-----------------------------------------|
 * | `matching.slots`    | yes       | copy the live seats onto the cohort     |
 * | `interactionPattern`| yes       | copy the live pattern onto the rotation |
 * | `routine`           | no        | the Builder has no routine to adopt     |
 * | `type`              | no        | a routine of the wrong type carries no  |
 * |                     |           | design values to take                   |
 *
 * The two unadoptable kinds are the reason this module exists rather than an
 * inline handler: a button that silently does nothing is worse here than a
 * disabled one, because the researcher reads the unchanged screen as agreement.
 */

import type { RoutineConfig } from "ame-shared";
import type { DriftEntry, SessionDesign } from "ame-shared/sessionDesign";

/** `DriftEntry.field` values adoption knows how to resolve. */
const AdoptableDriftFields = new Set<string>(["matching.slots", "interactionPattern"]);

/** `DriftEntry.field` for a routine the Builder no longer holds. */
const MissingRoutineField = "routine";

/**
 * Why "Adopt from Builder" is unavailable, or null when every reported
 * difference is one adoption can resolve.
 *
 * Reported for the FIRST unadoptable entry only: the strip already lists every
 * difference above the button, so this sentence exists to say what to press
 * instead, not to repeat the list.
 */
export function adoptDisabledReason(entries: DriftEntry[]): string | null {
  const blocker = entries.find((entry) => !AdoptableDriftFields.has(entry.field));
  if (!blocker) return null;

  if (blocker.field === MissingRoutineField) {
    return `${blocker.routineName} is not in the Builder, so there is nothing to adopt from. Use Overwrite from Design to recreate it.`;
  }

  return `${blocker.routineName} is a different kind of routine in the Builder, so it carries no values this block can adopt. Fix its type in the Builder, or use Overwrite from Design.`;
}

/**
 * The design patch that makes the block agree with the Builder.
 *
 * `cohortSize` is set from the same slots array as `seats`, because
 * `validateSessionDesign` refuses a design where the two disagree. The pattern
 * is taken from the TRIAL routine, which is where `compileSessionDesign` puts
 * it; adopting a `groupSize` the cohort cannot cover is allowed to raise the
 * validator's coverage error, which is the point — the Builder's value is then
 * on screen with the reason it cannot ship.
 *
 * Returns an empty patch when neither routine is present, so the caller can
 * skip a store write that would only mark the experiment dirty.
 */
export function adoptPatch(
  design: SessionDesign,
  routines: RoutineConfig[],
): Partial<SessionDesign> {
  const patch: Partial<SessionDesign> = {};

  const match = routines.find((routine) => routine.name === design.matchRoutineName);
  if (match?.matching) {
    const { slots, strategy, timeout, timeoutAction, assignment } = match.matching;
    patch.seats = structuredClone(slots);
    patch.cohortSize = slots.length;
    patch.strategy = strategy;
    patch.timeoutSeconds = timeout ?? design.timeoutSeconds;
    patch.timeoutAction = timeoutAction ?? design.timeoutAction;
    // Adopted rather than left alone: the Builder's live value is the one being
    // taken, so a routine the researcher set back to random must clear the
    // design's assignment, not have it re-applied on the next apply.
    patch.assignment = assignment ? structuredClone(assignment) : undefined;
  }

  const trial = routines.find((routine) => routine.name === design.trialRoutine);
  if (trial?.interactionPattern) {
    patch.pattern = structuredClone(trial.interactionPattern);
  }

  return patch;
}
