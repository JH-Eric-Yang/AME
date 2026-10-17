/**
 * roleAssignment — deciding which role index each member of a cohort receives.
 *
 * Pure by design. The maths is the part worth testing exhaustively, and it is
 * the part hardest to reach through a socket handler, so it lives away from
 * both the database and the namespace. `random` is injected for the same
 * reason: a test that cannot fix the randomness cannot assert on the result.
 */

import type { MatchingConfig, RoleAssignment } from "./types.js";

/** Beyond this, a complete permutation cycle needs more sessions than a study runs. */
export const MaxPermutationCohort = 4;

/** Every ordering of 0..n-1, lexicographically. */
function allPermutations(n: number): number[][] {
  if (n <= 1) return [[0]];
  const out: number[][] = [];
  const walk = (prefix: number[], rest: number[]) => {
    if (rest.length === 0) {
      out.push(prefix);
      return;
    }
    rest.forEach((value, i) => {
      walk([...prefix, value], [...rest.slice(0, i), ...rest.slice(i + 1)]);
    });
  };
  walk([], Array.from({ length: n }, (_, i) => i));
  return out;
}

/**
 * The permutations this scheme draws from.
 *
 * `rotation` gives n cyclic shifts — a Latin square, so every arrival position
 * holds every role exactly once per n sessions. `permutation` gives all n!.
 * They are identical at n = 2, which is why the choice only matters at three
 * or more roles.
 */
export function permutationSet(n: number, set: "rotation" | "permutation"): number[][] {
  // A cohort is never smaller than the matching route's MinSlotCount, so n >= 1.
  if (n <= 1) return [[0]];
  if (set === "permutation") return allPermutations(n);
  return Array.from({ length: n }, (_, shift) =>
    Array.from({ length: n }, (_, i) => (i + shift) % n),
  );
}

/** Fisher-Yates, with the randomness handed in so a test can pin it. */
function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The permutation this session receives, and the cycle state to persist.
 *
 * `permutation[i]` is the role index given to the participant who arrived in
 * position `i`.
 *
 * @param position how many sessions this experiment has already dealt
 * @param blockOrder the current block's remaining permutation indices
 * @param random injected so tests are deterministic
 */
export function nextAssignment(
  cohortSize: number,
  assignment: RoleAssignment,
  position: number,
  blockOrder: number[] | null,
  random: () => number,
): { permutation: number[]; nextPosition: number; nextBlockOrder: number[] | null } {
  const identity = Array.from({ length: cohortSize }, (_, i) => i);

  if (assignment.mode === "random") {
    // Random keeps no state: the cycle neither advances nor holds a block.
    return { permutation: shuffle(identity, random), nextPosition: position, nextBlockOrder: null };
  }

  const set = permutationSet(cohortSize, assignment.set);

  if (assignment.order === "sequential") {
    return {
      permutation: set[position % set.length],
      nextPosition: position + 1,
      nextBlockOrder: null,
    };
  }

  // block-shuffled: consume the block, refilling it when spent, so every
  // permutation appears exactly once per block while staying unpredictable
  // within it.
  //
  // The stored block holds INDICES into the set, but the cycle row is keyed per
  // experiment while the set is rebuilt from the CURRENT cohort size. A block
  // left by a 3-slot routine — or by a routine the researcher has since resized
  // — would otherwise index past a smaller set, `set[head]` would be undefined
  // and the caller's `roles[i]` would throw AFTER the cohort had already been
  // taken out of the waiting room, stranding it. So a stored index the current
  // set cannot honour is dropped, and a block left with nothing usable is
  // refilled as if it had been spent.
  const usable = (blockOrder ?? []).filter(
    (index) => Number.isInteger(index) && index >= 0 && index < set.length,
  );
  const remaining =
    usable.length > 0 ? usable : shuffle(set.map((_, i) => i), random);

  const [head, ...tail] = remaining;
  return {
    permutation: set[head],
    nextPosition: position + 1,
    nextBlockOrder: tail,
  };
}

/**
 * Why a combination is refused, or null when it is sound.
 *
 * Both refusals mean the researcher's model of their own study is wrong, so
 * they are errors rather than values silently ignored at runtime.
 */
export function validateRoleAssignment(matching: MatchingConfig): string | null {
  const assignment = matching.assignment;
  if (!assignment || assignment.mode !== "counterbalanced") return null;

  if (matching.strategy === "property") {
    return (
      "Counterbalancing cannot be combined with property matching: the slot " +
      "filters already decide who holds which role, so counterbalancing would " +
      "either be ignored or violate those filters."
    );
  }

  const n = matching.slots.length;
  if (assignment.set === "permutation" && n > MaxPermutationCohort) {
    const total = allPermutations(n).length;
    return (
      `Complete counterbalancing of ${n} roles needs ${total} sessions per cycle. ` +
      "Use rotation instead, which balances every arrival position in " +
      `${n} sessions.`
    );
  }

  return null;
}
