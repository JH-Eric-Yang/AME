import { test, expect } from "@playwright/test";
import { ChromiumMediaArgs } from "../fixtures/mediaFiles";
import { disconnect } from "../fixtures/seed";
import { startExperiment } from "../fixtures/participant";
import { deleteStimulusBench, seedStimulusBench, StimulusMarkers } from "../fixtures/seeds/stimulus";

/**
 * Stimulus behaviour when the browser blocks autoplay. Chromium allows play()
 * for a few seconds after the Next click, even with its strictest policy, so
 * the test cannot make the block happen. An init script refuses the first
 * play() with NotAllowedError, as a blocking browser does; later calls (the
 * participant's click on Play) use the real play() under the strict policy.
 */

test.use({
  launchOptions: { args: [...ChromiumMediaArgs, "--autoplay-policy=user-gesture-required"] },
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const realPlay = HTMLMediaElement.prototype.play;
    let refused = false;
    HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
      if (this instanceof HTMLAudioElement && !refused) {
        refused = true;
        return Promise.reject(new DOMException("play() is not allowed without a user gesture", "NotAllowedError"));
      }
      return realPlay.call(this);
    };
  });
});

let experimentId: string;

test.beforeAll(async () => {
  experimentId = await seedStimulusBench();
});

test.afterAll(async () => {
  await deleteStimulusBench();
  await disconnect();
});

test("audio shows a Play button when the browser blocks autoplay and controls are off", async ({ page }) => {
  await startExperiment(page, experimentId, StimulusMarkers.text);
  for (const marker of [StimulusMarkers.text, StimulusMarkers.image, StimulusMarkers.video]) {
    await expect(page.getByText(marker, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
  }
  await expect(page.getByText(StimulusMarkers.audio, { exact: true })).toBeVisible();

  // The precondition: the policy blocked the sound.
  const tone = page.locator("audio");
  await expect.poll(() => tone.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
  // The requirement: the participant can start the sound.
  const play = page.getByRole("button", { name: "Play" });
  await expect(play).toBeVisible({ timeout: 3_000 });
  await play.click();
  await expect.poll(() => tone.evaluate((a: HTMLAudioElement) => a.paused)).toBe(false);
  await expect(play).toHaveCount(0);
});
