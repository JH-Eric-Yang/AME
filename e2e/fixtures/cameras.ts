import { chromium, test, type Browser, type Locator, type Page } from "@playwright/test";
import { nearestColour, type ColourName } from "./colour";
import { cameraFile, ChromiumMediaArgs, type CameraColour } from "./mediaFiles";

/** Pixels sampled at the centre of a tile. */
const SampleSize = 16;

/**
 * Launch a separate browser whose fake camera shows one solid colour.
 * A browser context cannot change the fake camera, so each participant who
 * must be told apart needs a browser of their own. The caller closes it.
 */
export async function launchParticipant(
  colour: CameraColour,
): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({
    args: [...ChromiumMediaArgs, `--use-file-for-fake-video-capture=${cameraFile(colour)}`],
  });
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    permissions: ["camera", "microphone"],
  });
  return { browser, page: await context.newPage() };
}

/** The colour at the centre of a playing <video>. */
export async function tileColour(video: Locator): Promise<ColourName> {
  const rgb = await video.evaluate(async (element, size) => {
    const el = element as HTMLVideoElement;
    if (el.readyState < 2) {
      await new Promise((resolve) => el.addEventListener("loadeddata", resolve, { once: true }));
    }
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(el, el.videoWidth / 2 - size / 2, el.videoHeight / 2 - size / 2, size, size, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    const pixels = data.length / 4;
    return { r: r / pixels, g: g / pixels, b: b / pixels };
  }, SampleSize);
  return nearestColour(rgb);
}
