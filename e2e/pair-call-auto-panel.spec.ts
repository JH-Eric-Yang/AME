import { test, expect, type Browser, type Page } from "@playwright/test";
import {
  seedPairCallExperiment,
  deletePairCallExperiment,
  disconnect,
  PairCallTaskText,
  PairCallRoles,
} from "./fixtures/seed";

/**
 * The automatic video panel fits one screen: a titled task card and a framed
 * call panel, with no page scroll. The labels and arrangement are unit-tested
 * in callPanel.test.ts; this proves the routine draws them for two real browsers.
 */

let experimentId: string;

test.beforeAll(async () => {
  experimentId = await seedPairCallExperiment("auto");
});

test.afterAll(async () => {
  await deletePairCallExperiment("auto");
  await disconnect();
});

async function join(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ permissions: ["camera", "microphone"], viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.goto(`/experiment/${experimentId}`);
  await page.getByRole("button", { name: "Begin Experiment" }).click();
  await page.getByRole("button", { name: "I'm Ready" }).click();
  return page;
}

test("the automatic panel fits one screen, titles the card with the role and labels the partner", async ({ browser }) => {
  test.setTimeout(60_000);
  const pages = [await join(browser), await join(browser)];

  const roles: string[] = [];
  for (const page of pages) {
    await expect(page.getByText(PairCallTaskText)).toBeVisible({ timeout: 20_000 });
    const call = page.getByRole("region", { name: "Video call" });
    await expect(call.getByRole("status")).toHaveText("Connected", { timeout: 20_000 });

    const title = (await page.locator(".card-title").textContent())?.trim() ?? "";
    const role = PairCallRoles.find((r) => title === `${r} task`);
    expect(role, `card title "${title}"`).toBeTruthy();
    roles.push(role!);

    await expect
      .poll(() => page.evaluate(() => [...document.querySelectorAll("video")].map((v) => v.videoWidth > 0)))
      .toEqual([true, true]);
    // One screen: the page does not scroll, and the controls are inside the window.
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
    const mute = await call.getByRole("button", { name: "Mute" }).boundingBox();
    expect(mute!.y + mute!.height).toBeLessThanOrEqual(720);
  }

  // Each person has a different role, and sees the other's role on the partner video.
  expect(new Set(roles).size).toBe(2);
  for (const [i, page] of pages.entries()) {
    const other = roles[1 - i];
    await expect(page.getByRole("region", { name: "Video call" }).getByText(other, { exact: true })).toBeVisible();
  }
});
