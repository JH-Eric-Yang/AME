import { test, expect } from "@playwright/test";
import { seedTestExperiment, deleteTestExperiment, findErrorGroups, disconnect } from "./fixtures/seed";

/**
 * A browser failure reaches the error log.
 *
 * The error is raised as a real `error` event on window rather than thrown
 * inside `page.evaluate`, which Playwright would catch itself — the point is
 * to exercise the listener the runner actually installs
 * (`installErrorReporting` in `client/src/lib/errors/reporter.ts`).
 */

const SyntheticMessage = "E2E synthetic browser failure";
/** The sink batches; give it more than one flush interval (5s) plus slack. */
const FlushWaitMs = 8000;

let experimentId: string;

test.beforeAll(async () => {
  experimentId = await seedTestExperiment();
});

test.afterAll(async () => {
  await deleteTestExperiment();
  await disconnect();
});

test("a browser error is recorded against the participant", async ({ page }) => {
  await page.goto(`/experiment/${experimentId}`);
  await page.getByRole("button", { name: "Begin Experiment" }).click();
  await page.getByRole("button", { name: "I'm Ready" }).click();

  await page.evaluate((message) => {
    window.dispatchEvent(new ErrorEvent("error", { error: new Error(message), message }));
  }, SyntheticMessage);

  await expect(async () => {
    const groups = await findErrorGroups(experimentId);
    const group = groups.find((g) => g.message.includes(SyntheticMessage));
    expect(group).toBeDefined();
    expect(group!.source).toBe("CLIENT");
    expect(group!.events[0].participantId).not.toBeNull();
  }).toPass({ timeout: FlushWaitMs });
});
