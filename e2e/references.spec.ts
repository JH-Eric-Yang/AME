import { test, expect, type Page } from "@playwright/test";
import {
  seedReferencesExperiment,
  deleteReferencesExperiment,
  findResults,
  disconnect,
  ReferencesPrompt,
  ReferencesGreetingPrefix,
} from "./fixtures/seed";

/**
 * References, end to end: what step 0 collects is shown at step 1.
 *
 * Chromium's fake webcam produces frames, so the recorder makes a real (tiny)
 * WebM and tus uploads it; `canProceed` holds Next until that finishes, so by
 * the time step 1 is delivered the Upload row is COMPLETE.
 */

// autoStart began recording on mount; give the fake webcam time to produce at
// least one encoded frame before stopping.
const FakeWebcamWarmupMs = 1000;

let experimentId: string;

test.beforeAll(async () => {
  experimentId = await seedReferencesExperiment();
});

test.afterAll(async () => {
  await deleteReferencesExperiment();
  await disconnect();
});

async function startExperiment(page: Page): Promise<string> {
  await page.goto(`/experiment/${experimentId}`);
  await page.getByRole("button", { name: "Begin Experiment" }).click();
  await page.getByRole("button", { name: "I'm Ready" }).click();
  await expect(page.getByText(ReferencesPrompt)).toBeVisible();

  const responseId = await page.evaluate(
    (id) => localStorage.getItem(`ame-responseId-${id}`),
    experimentId,
  );
  expect(responseId).toBeTruthy();
  return responseId!;
}

test.describe("references", () => {
  test("a later step shows the name typed and the clip recorded earlier", async ({ page }) => {
    const responseId = await startExperiment(page);

    // The textfield element renders a bare <input> with a placeholder — no label.
    await page.getByPlaceholder("Your name").fill("Ada");
    await page.waitForTimeout(FakeWebcamWarmupMs);
    await page.getByRole("button", { name: "Stop Recording" }).click();
    const next = page.getByRole("button", { name: "Next" });
    await expect(next).toBeEnabled({ timeout: 15_000 });
    await next.click();

    await expect(page.getByText(`${ReferencesGreetingPrefix} Ada`)).toBeVisible();
    // The unresolved ref rendered as nothing, and the notice says so.
    await expect(page.getByText("[]")).toBeVisible();
    await expect(page.getByRole("status")).toContainText("could not be loaded");

    const video = page.locator("video").first();
    await expect(video).toHaveAttribute("src", /\/api\/uploads\/[^?]+\?token=/);
    // readyState ≥ 1 (HAVE_METADATA) proves the signed URL served playable bytes.
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1);

    const results = await findResults(experimentId, responseId);
    const intro = results.find((r) => r.routine === "intro");
    expect((intro?.response as Record<string, unknown>).name).toBe("Ada");
  });
});
