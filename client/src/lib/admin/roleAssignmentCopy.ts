/**
 * roleAssignmentCopy — stating what a chosen scheme actually guarantees.
 *
 * A researcher should read the design's promise off the screen rather than
 * infer it from two dropdowns, so this sentence sits under the control.
 *
 * Only a TYPE is imported from `ame-shared`, which is always safe in client
 * code — it is a runtime VALUE import from that package that client vitest
 * cannot resolve.
 */

import type { MatchingConfig } from "ame-shared";

function factorial(n: number): number {
  return n <= 1 ? 1 : n * factorial(n - 1);
}

/** One line naming the guarantee, for display under the assignment control. */
export function describeAssignment(matching: MatchingConfig): string {
  const n = matching.slots.length;

  if (matching.strategy === "property") {
    return "Slot filters decide who holds which role, so no assignment scheme applies.";
  }

  const assignment = matching.assignment ?? { mode: "random" as const };

  if (assignment.mode === "random") {
    return "Each session's roles are dealt at random, independently of every other session.";
  }

  const cycle = assignment.set === "permutation" ? factorial(n) : n;
  const shuffled =
    assignment.order === "block-shuffled"
      ? " Order within each block is shuffled, so the next assignment cannot be anticipated."
      : "";

  return `Across every ${cycle} sessions, each arrival position holds each role equally often.${shuffled}`;
}
