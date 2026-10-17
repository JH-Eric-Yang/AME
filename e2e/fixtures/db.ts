import { PrismaClient } from "@prisma/client";

/** The one Prisma client of the e2e suite; seed.ts's disconnect() closes it. */
export const prisma = new PrismaClient();
