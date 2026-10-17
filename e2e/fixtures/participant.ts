import { expect, type Page } from "@playwright/test";
import { findResults } from "./seed";

/**
 * Walk from the lobby into the first routine.
 *
 * @returns the participant's responseId; scope every database check by it.
 */
export async function startExperiment(
  page: Page,
  experimentId: string,
  firstMarker: string,
): Promise<string> {
  await page.goto(`/experiment/${experimentId}`);
  await page.getByRole("button", { name: "Begin Experiment" }).click();
  await page.getByRole("button", { name: "I'm Ready" }).click();
  await expect(page.getByText(firstMarker, { exact: true })).toBeVisible();

  const responseId = await page.evaluate(
    (id) => localStorage.getItem(`ame-responseId-${id}`),
    experimentId,
  );
  expect(responseId).toBeTruthy();
  return responseId!;
}

/** This participant's stored responses, keyed by routine name. */
export async function responsesByRoutine(
  experimentId: string,
  responseId: string,
): Promise<Map<string, Record<string, unknown>>> {
  const rows = await findResults(experimentId, responseId);
  return new Map(rows.map((row) => [row.routine, row.response as Record<string, unknown>]));
}
