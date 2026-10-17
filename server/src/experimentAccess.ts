import prisma from "./prisma.js";

/**
 * Whether this experimenter is attached to this experiment.
 *
 * Both the REST admin routes and the admin socket namespace gate on it. The
 * socket handshake only proves the caller holds a valid token, never that the
 * experiment they name is theirs, and the payloads they subscribe to carry
 * participants' recruitment ids — so authentication alone is not enough.
 */
export async function experimenterOwnsExperiment(
  experimenterId: string,
  experimentId: string,
): Promise<boolean> {
  const experiment = await prisma.experiment.findFirst({
    where: {
      id: experimentId,
      experimenters: { some: { experimenterId } },
    },
    select: { id: true },
  });
  return experiment !== null;
}
