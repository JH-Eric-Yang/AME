import { test, expect, type Page } from "@playwright/test";
import { disconnect } from "../fixtures/seed";
import { responsesByRoutine, startExperiment } from "../fixtures/participant";
import { installTrackRegister, liveTracks } from "../fixtures/tracks";
import {
  deleteMonitorBench,
  Keyword,
  MonitorMarkers,
  seedMonitorBench,
  TimerSeconds,
} from "../fixtures/seeds/monitor";

/** How long the strict volume check must stay unpassed. */
const StrictWatchMs = 3_000;
/** The phrase the speech stub "hears". */
const HeardPhrase = `please ${Keyword} now`;

let experimentId: string;

test.beforeAll(async () => {
  experimentId = await seedMonitorBench();
});

test.afterAll(async () => {
  await deleteMonitorBench();
  await disconnect();
});

/**
 * Replace SpeechRecognition with a stub that hears HeardPhrase 300 ms after
 * start. Real recognition sends audio to a Google service, which a test
 * browser cannot rely on; the manual checklist covers it.
 */
async function stubSpeech(page: Page): Promise<void> {
  await page.addInitScript((phrase) => {
    class FakeRecognition {
      onresult: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      lang = "";
      continuous = false;
      interimResults = false;
      start() {
        setTimeout(() => this.onresult?.({ results: [[{ transcript: phrase }]] }), 300);
      }
      stop() {}
    }
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
  }, HeardPhrase);
}

/** Start, wait out the timer, and pass the strict check with Next. */
async function toVolume(page: Page): Promise<string> {
  const responseId = await startExperiment(page, experimentId, MonitorMarkers.timer);
  await expect(page.getByText(MonitorMarkers.strictVolume, { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Next" }).click();
  return responseId;
}

test.describe("monitor elements", () => {
  test("timer counts down and its timeout proceeds", async ({ page }) => {
    await startExperiment(page, experimentId, MonitorMarkers.timer);
    const startedAt = Date.now();
    await expect(page.getByText(`${TimerSeconds}s`, { exact: true })).toBeVisible();
    await expect(page.getByText(MonitorMarkers.strictVolume, { exact: true })).toBeVisible({ timeout: 10_000 });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual((TimerSeconds - 1) * 1000);
  });

  test("volume check with an unreachable threshold does not pass", async ({ page }) => {
    await startExperiment(page, experimentId, MonitorMarkers.timer);
    await expect(page.getByText(MonitorMarkers.strictVolume, { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(StrictWatchMs);
    await expect(page.getByText("Microphone working.")).toHaveCount(0);
  });

  test("volume check passes on the fake microphone noise and releases the microphone", async ({ page }) => {
    await installTrackRegister(page);
    const responseId = await toVolume(page);

    await expect(page.getByText(MonitorMarkers.speech, { exact: true })).toBeVisible({ timeout: 10_000 });
    expect(await liveTracks(page)).toEqual([]);
    await expect
      .poll(async () => (await responsesByRoutine(experimentId, responseId)).get("volume-trial"))
      .toMatchObject({ mic: { passed: true } });
  });

  test("speech recognizer fires its keyword trigger and records the transcript", async ({ page }) => {
    await stubSpeech(page);
    const responseId = await toVolume(page);

    await expect(page.getByText(MonitorMarkers.done, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(async () => (await responsesByRoutine(experimentId, responseId)).get("speech-trial"))
      .toMatchObject({ speech: { keyword: Keyword, transcript: HeardPhrase } });
  });
});
