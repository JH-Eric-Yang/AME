import type { ElementConfig, RoutineConfig } from "ame-shared";
import { prisma } from "../db";

/** A one-column grid: every element stacks in order. */
const SingleColumn = { rows: [{ columns: [{ span: 12 }] }] };

export function card(name: string, elements: ElementConfig[]): RoutineConfig {
  return { name, type: "routine-card", layout: SingleColumn, elements };
}

export function nextButton(name = "next"): ElementConfig {
  return {
    name,
    type: "button",
    params: { label: "Next" },
    events: [{ trigger: "click", type: "proceed" }],
  };
}

/** A routine's unique assertion string, so a test knows which routine shows. */
export function marker(content: string): ElementConfig {
  return { name: "marker", type: "text", params: { content } };
}

export function endRoutine(content: string): RoutineConfig {
  return {
    name: "finish",
    type: "routine-end",
    layout: SingleColumn,
    elements: [{ name: "bye", type: "text", params: { content } }],
  };
}

/** Remove any earlier run's bench of this name, then create it with one content row per routine. */
export async function createBench(name: string, routines: RoutineConfig[]): Promise<string> {
  await deleteBench(name);
  const experiment = await prisma.experiment.create({
    data: {
      name,
      description: "Automated end-to-end coverage. Safe to delete.",
      visible: true,
      allowNew: true,
      conditions: ["Basic"],
      participantsPerSession: 1,
      routines: routines as unknown as object,
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

export async function deleteBench(name: string): Promise<void> {
  await prisma.experiment.deleteMany({ where: { name } });
}
