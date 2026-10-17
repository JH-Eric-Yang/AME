/**
 * roleCycle — the persistent half of role assignment.
 *
 * Counterbalancing is the only stateful mode: it has to know what previous
 * sessions received. Random draws independently and remembers nothing, which is
 * why it never touches the row — taking a write lock for it would serialise
 * every concurrent match behind a value nobody reads.
 */

import { Prisma } from "@prisma/client";
import type { RoleAssignment } from "ame-shared";
import { nextAssignment } from "ame-shared/roleAssignment";
import prisma from "./prisma.js";

/** Row shape read back by the locking `SELECT ... FOR UPDATE` below. */
interface LockedCycleRow {
  position: number;
  blockOrder: unknown;
}

/**
 * The role index for each arrival position in a newly matched cohort.
 *
 * @returns `permutation`, where `permutation[i]` is the role index given to the
 *          participant who arrived in position `i`.
 */
export async function dealRoles(
  experimentId: string,
  cohortSize: number,
  assignment: RoleAssignment,
): Promise<number[]> {
  if (assignment.mode === "random") {
    const { permutation } = nextAssignment(cohortSize, assignment, 0, null, Math.random);
    return permutation;
  }

  // Two cohorts can reach quorum at the same instant. Under Postgres's default
  // READ COMMITTED isolation, an ordinary read-then-write inside a transaction
  // is NOT enough to stop this: both transactions can read the same position
  // before either writes, producing a lost update. The upsert below only
  // guarantees the row exists; it is the explicit `SELECT ... FOR UPDATE` that
  // actually takes the row lock, so a second cohort blocks until the first
  // commits and then reads ITS result rather than a stale position.
  return prisma.$transaction(async (tx) => {
    await tx.roleAssignmentCycle.upsert({
      where: { experimentId },
      create: { experimentId, position: 0, blockOrder: undefined },
      update: {},
    });

    const locked = await tx.$queryRaw<LockedCycleRow[]>`
      SELECT "position", "blockOrder" FROM "RoleAssignmentCycle"
      WHERE "experimentId" = ${experimentId}
      FOR UPDATE
    `;
    const cycle = locked[0];

    const stored = Array.isArray(cycle.blockOrder) ? (cycle.blockOrder as number[]) : null;
    const result = nextAssignment(cohortSize, assignment, cycle.position, stored, Math.random);

    await tx.roleAssignmentCycle.update({
      where: { experimentId },
      data: {
        position: result.nextPosition,
        // `undefined` reads as "leave unchanged" to Prisma, which would let a
        // block left by a previous block-shuffled configuration survive a
        // switch to sequential and then be consumed against a set it no longer
        // describes. `Prisma.DbNull` actually nulls the column.
        blockOrder: result.nextBlockOrder ?? Prisma.DbNull,
      },
    });

    return result.permutation;
  });
}
