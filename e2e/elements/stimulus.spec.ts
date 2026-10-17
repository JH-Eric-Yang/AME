import { test, expect, type Page } from "@playwright/test";
import { disconnect } from "../fixtures/seed";
import { startExperiment } from "../fixtures/participant";
import {
  BenchPictureAlt,
  deleteStimulusBench,
  seedStimulusBench,
  StimulusMarkers,
  TimedOnsetMs,
  TimedWords,
} from "../fixtures/seeds/stimulus";

/** Timer tolerance: a timeout can fire early by up to one event-loop turn. */
const EarlyToleranceMs = 100;
/** A time near the end of the 2 s stimulus clip. */
const LateInClipSec = 1.5;
/** A time near the start of the clip, which a loop returns to. */
const EarlyInClipSec = 1;
/** How long a video without autoplay must stay paused. */
const StillWatchMs = 1_500;
/** How long to watch for one loop of the 2 s clip. */
const LoopWatchMs = 6_000;

let experimentId: string;

test.beforeAll(async () => {
  experimentId = await seedStimulusBench();
});

test.afterAll(async () => {
  await deleteStimulusBench();
  await disconnect();
});

const Order = [StimulusMarkers.text, StimulusMarkers.image, StimulusMarkers.video, StimulusMarkers.audio];

/** Start, then click Next through each routine before `target`, and wait until `target` shows. */
async function goTo(page: Page, target: (typeof Order)[number]): Promise<void> {
  await startExperiment(page, experimentId, StimulusMarkers.text);
  for (const current of Order) {
    await expect(page.getByText(current, { exact: true })).toBeVisible();
    if (current === target) return;
    await page.getByRole("button", { name: "Next" }).click();
  }
}

test.describe("stimulus elements", () => {
  test("text appears at its onset time and leaves after its duration", async ({ page }) => {
    await goTo(page, StimulusMarkers.text);
    const shownAt = Date.now();
    const timed = page.getByText(TimedWords, { exact: true });

    await expect(timed).toHaveCount(0);
    await expect(timed).toBeVisible({ timeout: 5_000 });
    expect(Date.now() - shownAt).toBeGreaterThanOrEqual(TimedOnsetMs - EarlyToleranceMs - 500);

    // disappearMode defaults to "removed".
    await expect(timed).toHaveCount(0, { timeout: 5_000 });
  });

  test("image loads its source", async ({ page }) => {
    await goTo(page, StimulusMarkers.image);
    const image = page.getByAltText(BenchPictureAlt);
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  });

  test("video plays on its own when autoplay is set", async ({ page }) => {
    await goTo(page, StimulusMarkers.video);
    const clip = page.locator("video").first();
    await expect
      .poll(() => clip.evaluate((v: HTMLVideoElement) => ({ playing: !v.paused, loop: v.loop, moved: v.currentTime > 0.3 })))
      .toEqual({ playing: true, loop: true, moved: true });

    // loop: the 2 s clip passes LateInClipSec, then starts again from the beginning.
    // The page watches every timeupdate, because a poll from here can miss the short window.
    const looped = await clip.evaluate(
      (v: HTMLVideoElement, { late, early, limitMs }) =>
        new Promise<boolean>((resolve) => {
          let pastLate = false;
          const onTime = () => {
            if (v.currentTime > late) pastLate = true;
            else if (pastLate && v.currentTime < early) finish(true);
          };
          const finish = (result: boolean) => {
            v.removeEventListener("timeupdate", onTime);
            resolve(result);
          };
          v.addEventListener("timeupdate", onTime);
          setTimeout(() => finish(false), limitMs);
        }),
      { late: LateInClipSec, early: EarlyInClipSec, limitMs: LoopWatchMs },
    );
    expect(looped, "the clip starts again after its end").toBe(true);
  });

  test("video without autoplay stays paused", async ({ page }) => {
    await goTo(page, StimulusMarkers.video);
    const still = page.locator("video").nth(1);
    await page.waitForTimeout(StillWatchMs);
    expect(await still.evaluate((v: HTMLVideoElement) => ({ paused: v.paused, time: v.currentTime }))).toEqual({
      paused: true,
      time: 0,
    });
  });

  test("video shows controls only when controls is set", async ({ page }) => {
    await goTo(page, StimulusMarkers.video);
    const controls = await page
      .locator("video")
      .evaluateAll((videos) => videos.map((v) => v.hasAttribute("controls")));
    expect(controls).toEqual([false, true]);
  });

  test("audio plays on its own after the participant has clicked", async ({ page }) => {
    // The lobby and Next clicks give the page a user activation, so Chromium's
    // autoplay policy allows sound. Without it the participant hears nothing
    // and, with controls off, has no way to start the sound.
    await goTo(page, StimulusMarkers.audio);
    const tone = page.locator("audio");
    await expect
      .poll(() => tone.evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > 0.2))
      .toBe(true);
    // Autoplay was allowed, so the element shows no Play button of its own.
    await expect(page.getByRole("button", { name: "Play" })).toHaveCount(0);
  });
});
