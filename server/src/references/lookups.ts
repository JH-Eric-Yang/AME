/**
 * lookups — the Prisma side of reference resolution. Kept apart from
 * `resolve.ts` so the resolver stays testable with stubs.
 *
 * Both queries lean on columns that already exist: ExperimentResult and
 * Upload record `progress` (the position experienced) and `trial` (the
 * content row's trialNumber), so no schema change is needed (spec §3.4).
 */

import prisma from "../prisma.js";
import type { RefWhere } from "ame-shared/refs";
import type { ReferenceLookups } from "./resolve.js";

function whereClause(where: RefWhere): { progress: number } | { trial: number } {
  return where.kind === "position" ? { progress: where.n } : { trial: where.k };
}

export function prismaLookups(experimentId: string): ReferenceLookups {
  return {
    async latestResult(participantId, where) {
      const row = await prisma.experimentResult.findFirst({
        where: {
          experimentId,
          participantId,
          ...whereClause(where),
          ...(where.kind === "trial" && where.routine ? { routine: where.routine } : {}),
        },
        orderBy: { createdAt: "desc" },
        select: { routine: true, response: true },
      });
      return row ? { routine: row.routine, response: (row.response as Record<string, unknown>) ?? {} } : null;
    },

    // Upload has no routine column, so a `t<K>:<routine>` qualifier cannot
    // narrow it; element name + trial is what identifies the file.
    async latestUpload(participantId, where, element) {
      const row = await prisma.upload.findFirst({
        where: { experimentId, participantId, elementName: element, ...whereClause(where) },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, filePath: true, mimeType: true },
      });
      return row;
    },
  };
}
