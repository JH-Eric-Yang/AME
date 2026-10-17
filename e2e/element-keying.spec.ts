import { test, expect } from "@playwright/test";
import { seedKeyingExperiment, deleteKeyingExperiment, disconnect } from "./fixtures/seed";

let experimentId: string;

/**
 * Trial two's timer runs for 5s, so the assertions that wait for it to expire
 * need longer than expect's 5s default.
 */
const TimerExpiryTimeoutMs = 15_000;

test.beforeAll(async () => {
  experimentId = await seedKeyingExperiment();
});

test.afterAll(async () => {
  await deleteKeyingExperiment();
  await disconnect();
});

test("a timer remounts on the second consecutive card progress", async ({ page }) => {
  await page.goto(`/experiment/${experimentId}`);
  await page.getByRole("button", { name: "Begin Experiment" }).click();
  await page.getByRole("button", { name: "I'm Ready" }).click();

  const clock = page.locator(".el-timer");

  // Trial one: the timer mounts, counts, and proceeds on expiry.
  await expect(page.getByText("Timer bench trial one")).toBeVisible();
  await expect(clock).toHaveText(/^[1-9]\d*s$/);

  // Trial two reuses the RoutineCard instance and the element name `clock`.
  await expect(page.getByText("Timer bench trial two")).toBeVisible({
    timeout: TimerExpiryTimeoutMs,
  });

  // A stale timer instance sits at 0s forever; a remounted one is counting.
  await expect(clock).toHaveText(/^[1-9]\d*s$/);

  // And the load-bearing half: a stale timer's interval was already cleared, so
  // its `timeout` event never fires again and the participant is trapped here.
  await expect(page.getByText("Timer bench done")).toBeVisible({
    timeout: TimerExpiryTimeoutMs,
  });
});
