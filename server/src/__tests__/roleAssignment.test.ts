import { describe, it, expect } from "vitest";
import type { MatchingConfig } from "ame-shared";
import {
  permutationSet,
  nextAssignment,
  validateRoleAssignment,
} from "ame-shared/roleAssignment";

/** A deterministic stand-in for Math.random: walks a fixed list, then repeats. */
function seeded(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("permutationSet", () => {
  it("gives n cyclic rotations", () => {
    expect(permutationSet(3, "rotation")).toEqual([
      [0, 1, 2],
      [1, 2, 0],
      [2, 0, 1],
    ]);
  });

  it("gives all n! orderings", () => {
    expect(permutationSet(3, "permutation")).toEqual([
      [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
    ]);
  });

  it("is identical for both sets at two roles", () => {
    // Why the distinction only matters at three or more.
    expect(permutationSet(2, "rotation")).toEqual(permutationSet(2, "permutation"));
  });

  it("gives the single identity for one role", () => {
    expect(permutationSet(1, "rotation")).toEqual([[0]]);
    expect(permutationSet(1, "permutation")).toEqual([[0]]);
  });
});

describe("nextAssignment — random", () => {
  it("permutes the cohort", () => {
    const result = nextAssignment(3, { mode: "random" }, 0, null, seeded([0.99, 0.99, 0.99]));

    expect([...result.permutation].sort()).toEqual([0, 1, 2]);
  });

  it("keeps no state, so the cycle never advances", () => {
    const result = nextAssignment(2, { mode: "random" }, 7, null, seeded([0.5]));

    expect(result.nextPosition).toBe(7);
    expect(result.nextBlockOrder).toBeNull();
  });
});

describe("nextAssignment — counterbalanced, sequential", () => {
  const cb: MatchingConfig["assignment"] = {
    mode: "counterbalanced", set: "rotation", order: "sequential",
  };

  it("walks the set in order", () => {
    const first = nextAssignment(2, cb!, 0, null, seeded([0.5]));
    const second = nextAssignment(2, cb!, first.nextPosition, null, seeded([0.5]));

    expect(first.permutation).toEqual([0, 1]);
    expect(second.permutation).toEqual([1, 0]);
    expect(second.nextPosition).toBe(2);
  });

  it("is perfectly balanced at every multiple of the set size", () => {
    // The property the mode exists to provide: over 6 sessions of 3 roles,
    // every arrival position holds every role exactly twice.
    const counts = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    let position = 0;
    for (let i = 0; i < 6; i++) {
      const r = nextAssignment(3, cb!, position, null, seeded([0.5]));
      r.permutation.forEach((role, seat) => { counts[seat][role] += 1; });
      position = r.nextPosition;
    }

    expect(counts).toEqual([[2, 2, 2], [2, 2, 2], [2, 2, 2]]);
  });

  it("wraps back to the start of the set", () => {
    const r = nextAssignment(2, cb!, 4, null, seeded([0.5]));

    expect(r.permutation).toEqual([0, 1]);
  });
});

describe("nextAssignment — counterbalanced, block-shuffled", () => {
  const cb: MatchingConfig["assignment"] = {
    mode: "counterbalanced", set: "rotation", order: "block-shuffled",
  };

  it("uses each permutation exactly once per block", () => {
    let position = 0;
    let block: number[] | null = null;
    const seen: string[] = [];

    for (let i = 0; i < 3; i++) {
      const r = nextAssignment(3, cb!, position, block, seeded([0.9, 0.1, 0.5]));
      seen.push(r.permutation.join(""));
      position = r.nextPosition;
      block = r.nextBlockOrder;
    }

    expect(new Set(seen).size).toBe(3);
  });

  it("refills the block once it is spent", () => {
    const r = nextAssignment(2, cb!, 0, [], seeded([0.9]));

    expect(r.permutation).toHaveLength(2);
    expect(r.nextBlockOrder).not.toBeNull();
  });

  // The cycle row is keyed per experiment but the permutation set is rebuilt
  // from the CURRENT cohort size, so a block left by a 3-slot routine can be
  // read back against a 2-element set. Before this guard `set[2]` was
  // undefined, `dealRoles` returned undefined and the caller threw — after the
  // cohort had already left the waiting room.
  it("survives a block left by a larger cohort", () => {
    const r = nextAssignment(2, cb!, 5, [2, 0], seeded([0.9]));

    expect([...r.permutation].sort()).toEqual([0, 1]);
  });

  it("refills when a stale block holds nothing the current set can honour", () => {
    const r = nextAssignment(2, cb!, 5, [4, 3, 2], seeded([0.9]));

    expect([...r.permutation].sort()).toEqual([0, 1]);
    // Nothing usable survived, so the block is refilled rather than left empty
    // and re-read as "spent" on every subsequent session.
    expect(r.nextBlockOrder).toHaveLength(1);
  });
});

describe("validateRoleAssignment", () => {
  const base: MatchingConfig = { strategy: "fifo", slots: [{ name: "a" }, { name: "b" }] };

  it("accepts a routine with no assignment at all", () => {
    expect(validateRoleAssignment(base)).toBeNull();
  });

  it("accepts random with property matching", () => {
    expect(
      validateRoleAssignment({ ...base, strategy: "property", assignment: { mode: "random" } }),
    ).toBeNull();
  });

  it("refuses counterbalancing under property matching", () => {
    const issue = validateRoleAssignment({
      ...base,
      strategy: "property",
      assignment: { mode: "counterbalanced", set: "rotation", order: "sequential" },
    });

    expect(issue).toContain("property");
  });

  it("refuses full permutation for a cohort larger than four", () => {
    const issue = validateRoleAssignment({
      ...base,
      slots: [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }, { name: "e" }],
      assignment: { mode: "counterbalanced", set: "permutation", order: "sequential" },
    });

    expect(issue).toContain("120");
  });

  it("accepts full permutation at exactly four", () => {
    expect(
      validateRoleAssignment({
        ...base,
        slots: [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }],
        assignment: { mode: "counterbalanced", set: "permutation", order: "sequential" },
      }),
    ).toBeNull();
  });
});
