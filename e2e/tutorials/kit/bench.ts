import bcrypt from "bcryptjs";
import type { ElementConfig, RoutineConfig } from "ame-shared";
import { prisma } from "../../fixtures/db";
import { endRoutine, nextButton } from "../../fixtures/seeds/common";

/**
 * One experiment for each tutorial. Its card routine `trial` has three rows:
 * the question, an empty row for the element the researcher drags in, and
 * the Next button. The researcher who signs in owns all of them.
 */

export const TutorialAdminEmail = "tutorial-researcher@e2e.test";
export const TutorialAdminPassword = "tutorial-researcher-password";
const TutorialAdminName = "Tutorial Researcher";
const BcryptRounds = 4;
const NamePrefix = "Tutorial — ";

export const TrialRoutine = "trial";
/** The grid row (1-based, as the Builder labels it) that stays empty for the element. */
export const DropRow = 2;
/** Elements in the routine before the drop; the Builder names the new element `<type>-<count + 1>`. */
export const SeededElementCount = 2;
export const EndText = "Thank you. The study is complete.";

const FullRow = { columns: [{ span: 12 }] };

export async function createTutorialBench(label: string, question: string): Promise<string> {
  const name = `${NamePrefix}${label}`;
  await prisma.experiment.deleteMany({ where: { name } });
  const researcher = await prisma.experimenter.upsert({
    where: { email: TutorialAdminEmail },
    update: {},
    create: {
      email: TutorialAdminEmail,
      password: await bcrypt.hash(TutorialAdminPassword, BcryptRounds),
      name: TutorialAdminName,
      role: "EXPERIMENTER",
      status: "APPROVED",
    },
  });
  const elements: ElementConfig[] = [
    { name: "question", type: "text", params: { content: question, fontSize: "22px" }, position: { row: 0, column: 0, order: 0 } },
    { ...nextButton(), position: { row: 2, column: 0, order: 0 } },
  ];
  const routines: RoutineConfig[] = [
    { name: TrialRoutine, type: "routine-card", layout: { rows: [FullRow, FullRow, FullRow] }, elements },
    endRoutine(EndText),
  ];
  const experiment = await prisma.experiment.create({
    data: {
      name,
      description: "A tutorial experiment. Safe to delete.",
      visible: true,
      allowNew: true,
      conditions: ["Basic"],
      participantsPerSession: 1,
      routines: routines as unknown as object,
      experimenters: { create: { experimenterId: researcher.id } },
    },
  });
  await prisma.experimentContent.createMany({
    data: routines.map((routine, progress) => ({
      experimentId: experiment.id,
      progress,
      trialNumber: 1,
      routine: routine.name,
      condition: "Basic",
      content: {},
    })),
  });
  return experiment.id;
}

/** Remove every tutorial experiment and the tutorial researcher. */
export async function deleteTutorialBenches(): Promise<void> {
  await prisma.experiment.deleteMany({ where: { name: { startsWith: NamePrefix } } });
  await prisma.experimenter.deleteMany({ where: { email: TutorialAdminEmail } });
}
