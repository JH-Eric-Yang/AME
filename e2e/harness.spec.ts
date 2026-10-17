import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import {
  CacheDir,
  CameraColours,
  cameraFile,
  MediaRecipes,
  MicrophoneFile,
  recipeFile,
  StimulusAudioFile,
  StimulusVideoFile,
} from "./fixtures/mediaFiles";
import { requireTool } from "./fixtures/globalSetup";
import { nearestColour } from "./fixtures/colour";
import { frameColour, probeFile } from "./fixtures/media";
import { launchParticipant, tileColour } from "./fixtures/cameras";
import { installTrackRegister, liveTracks } from "./fixtures/tracks";

/**
 * Tests of the e2e helpers themselves. A broken helper must fail here, with a
 * clear name, and not as a confusing failure inside an element test.
 */

test.describe("generated media files", () => {
  test("global setup makes the camera, microphone and stimulus files", async () => {
    const files = [...CameraColours.map(cameraFile), MicrophoneFile, StimulusVideoFile, StimulusAudioFile];
    for (const file of files) {
      const stat = await fs.stat(file);
      expect(stat.size, file).toBeGreaterThan(0);
    }
  });

  test("a changed ffmpeg recipe gives a new file name", () => {
    const before = recipeFile("probe", { ext: "wav", args: ["-i", "a"] });
    const after = recipeFile("probe", { ext: "wav", args: ["-i", "b"] });
    expect(before).not.toBe(after);
    expect(recipeFile("probe", { ext: "wav", args: ["-i", "a"] })).toBe(before);
  });

  test("the cache holds only the current files, with no partial file", async () => {
    const expected = MediaRecipes.map((r) => path.basename(r.file)).sort();
    expect((await fs.readdir(CacheDir)).sort()).toEqual(expected);
  });

  test("a missing tool stops the setup with an install hint", async () => {
    await expect(requireTool("ame-no-such-tool")).rejects.toThrow(
      /ame-no-such-tool is required by the e2e suite/,
    );
  });
});

test.describe("media helpers", () => {
  test("nearestColour names a dominant channel and refuses a grey", () => {
    expect(nearestColour({ r: 250, g: 10, b: 20 })).toBe("red");
    expect(nearestColour({ r: 0, g: 128, b: 0 })).toBe("green");
    expect(nearestColour({ r: 30, g: 40, b: 220 })).toBe("blue");
    expect(nearestColour({ r: 120, g: 120, b: 120 })).toBe("other");
  });

  test("probeFile reads the streams and the duration of the stimulus clip", async () => {
    const probe = await probeFile(StimulusVideoFile);
    expect(probe.streams).toEqual([
      { type: "video", codec: "vp8" },
      { type: "audio", codec: "opus" },
    ]);
    expect(probe.durationSec).toBeGreaterThan(1.5);
    expect(probe.durationSec).toBeLessThan(2.5);
  });

  test("frameColour reads the colour of each camera file", async () => {
    for (const colour of CameraColours) {
      expect(await frameColour(cameraFile(colour), 1)).toBe(colour);
    }
  });
});

test.describe("browser helpers", () => {
  test("a participant browser shows its own camera colour", async () => {
    const { browser, page } = await launchParticipant("blue");
    try {
      await page.goto("/");
      await page.evaluate(async () => {
        const video = document.createElement("video");
        video.muted = true;
        video.srcObject = await navigator.mediaDevices.getUserMedia({ video: true });
        document.body.append(video);
        await video.play();
      });
      expect(await tileColour(page.locator("video").last())).toBe("blue");
    } finally {
      await browser.close();
    }
  });

  test("liveTracks lists open tracks until they stop", async ({ page }) => {
    await installTrackRegister(page);
    await page.goto("/");
    await page.evaluate(async () => {
      (window as unknown as { held: MediaStream }).held =
        await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    });
    expect((await liveTracks(page)).sort()).toEqual(["audio", "video"]);

    await page.evaluate(() =>
      (window as unknown as { held: MediaStream }).held.getTracks().forEach((t) => t.stop()),
    );
    expect(await liveTracks(page)).toEqual([]);
  });
});
