import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import prisma from "../prisma.js";
import { dealRoles } from "../roleCycle.js";

vi.mock("../prisma.js", () => ({
  default: {
    $transaction: vi.fn(),
    roleAssignmentCycle: { upsert: vi.fn(), update: vi.fn() },
  },
}));

/** Runs the callback against a stub tx, as $transaction does. */
function withTx(cycle: { position: number; blockOrder: unknown } | null) {
  const row = cycle ?? { position: 0, blockOrder: null };
  const tx = {
    roleAssignmentCycle: {
      upsert: vi.fn(async () => row),
      update: vi.fn(
        async (_args: {
          where: { experimentId: string };
          data: { position: number; blockOrder?: unknown };
        }) => ({}),
      ),
    },
    // The row lock is taken here, not by the upsert above, so the mock's
    // return value is what the implementation actually reads position from.
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, ..._values: unknown[]) => [row]),
  };
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(tx));
  return tx;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dealRoles", () => {
  it("returns a permutation of the cohort for random", async () => {
    withTx(null);

    const roles = await dealRoles("exp-1", 3, { mode: "random" });

    expect([...roles].sort()).toEqual([0, 1, 2]);
  });

  it("does not touch the cycle for random", async () => {
    const tx = withTx(null);

    await dealRoles("exp-1", 2, { mode: "random" });

    // Random keeps no state, so it must not take the row's write lock and
    // serialise every concurrent match behind it.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.roleAssignmentCycle.update).not.toHaveBeenCalled();
  });

  it("advances the cycle inside a transaction for counterbalanced", async () => {
    const tx = withTx({ position: 0, blockOrder: null });

    const roles = await dealRoles("exp-1", 2, {
      mode: "counterbalanced", set: "rotation", order: "sequential",
    });

    expect(roles).toEqual([0, 1]);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(tx.roleAssignmentCycle.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ position: 1 }) }),
    );
  });

  it("takes a locking read before computing the next assignment", async () => {
    const tx = withTx({ position: 0, blockOrder: null });

    await dealRoles("exp-1", 2, {
      mode: "counterbalanced", set: "rotation", order: "sequential",
    });

    // A later refactor that drops the locking read but keeps returning the
    // right permutation (e.g. by reading the upsert's return value again)
    // would still pass every other test here. This one pins down that a
    // genuine `FOR UPDATE` read happens, so that regression can't hide.
    expect(tx.$queryRaw).toHaveBeenCalled();
    const [strings] = tx.$queryRaw.mock.calls[0];
    expect(strings.join(" ")).toContain("FOR UPDATE");
  });

  it("continues from the stored position", async () => {
    withTx({ position: 1, blockOrder: null });

    const roles = await dealRoles("exp-1", 2, {
      mode: "counterbalanced", set: "rotation", order: "sequential",
    });

    expect(roles).toEqual([1, 0]);
  });

  it("persists the remaining block for block-shuffled", async () => {
    const tx = withTx({ position: 0, blockOrder: null });

    await dealRoles("exp-1", 3, {
      mode: "counterbalanced", set: "rotation", order: "block-shuffled",
    });

    const data = tx.roleAssignmentCycle.update.mock.calls[0][0].data;
    expect(Array.isArray(data.blockOrder)).toBe(true);
    expect(data.blockOrder).toHaveLength(2);
  });

  // Prisma reads `undefined` as "leave this column alone", so writing it back
  // would let a block left by a previous block-shuffled configuration outlive
  // the switch away from it and then be consumed against a set it no longer
  // describes.
  it("clears a stale block when the mode no longer keeps one", async () => {
    const tx = withTx({ position: 0, blockOrder: [1, 0] });

    await dealRoles("exp-1", 2, {
      mode: "counterbalanced", set: "rotation", order: "sequential",
    });

    const data = tx.roleAssignmentCycle.update.mock.calls[0][0].data;
    expect(data.blockOrder).toBe(Prisma.DbNull);
  });

  it("deals a valid permutation from a block left by a larger cohort", async () => {
    withTx({ position: 3, blockOrder: [2, 1] });

    const roles = await dealRoles("exp-1", 2, {
      mode: "counterbalanced", set: "rotation", order: "block-shuffled",
    });

    expect([...roles].sort()).toEqual([0, 1]);
  });
});
