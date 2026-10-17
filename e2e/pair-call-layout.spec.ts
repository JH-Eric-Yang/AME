import { test, expect, type Browser, type Page } from "@playwright/test";
import {
  seedPairCallExperiment,
  deletePairCallExperiment,
  disconnect,
  PairCallTaskText,
} from "./fixtures/seed";

/**
 * A video-chat routine with `videoLayout: "custom"` shows only the tiles the
 * researcher placed: no automatic video panel, and each tile carries live
 * media. The tile planning is unit-tested in callPlan.test.ts; this proves the
 * routine draws it and two real browsers connect.
 */

let experimentId: string;

test.beforeAll(async () => {
  experimentId = await seedPairCallExperiment();
});

test.afterAll(async () => {
  await deletePairCallExperiment();
  await disconnect();
});

/** Pages whose socket received the ICE server list after the join. */
const gotIceServers = new WeakSet<Page>();

async function join(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ permissions: ["camera", "microphone"] });
  const page = await context.newPage();
  page.on("websocket", (ws) =>
    ws.on("framereceived", ({ payload }) => {
      if (String(payload).includes('"ice:servers"')) gotIceServers.add(page);
    }),
  );
  await page.goto(`/experiment/${experimentId}`);
  await page.getByRole("button", { name: "Begin Experiment" }).click();
  await page.getByRole("button", { name: "I'm Ready" }).click();
  return page;
}

/** For each video on the page: true when it plays frames. */
const tileState = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("video")].map((video) => video.videoWidth > 0),
  );

test("a custom video layout shows the placed tiles and connects the pair", async ({ browser }) => {
  test.setTimeout(60_000);
  const pages = [await join(browser), await join(browser)];

  for (const page of pages) {
    await expect(page.getByText(PairCallTaskText)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Partner tile")).toBeVisible();
    await expect(page.getByText("Self tile")).toBeVisible();
    // The automatic panel has a "Partner" placeholder or a third video; custom has neither.
    await expect(page.locator(".video-panel")).toHaveCount(0);
    await expect.poll(() => tileState(page), { timeout: 20_000 }).toEqual([true, true]);
    expect(gotIceServers.has(page)).toBe(true);
  }
});
