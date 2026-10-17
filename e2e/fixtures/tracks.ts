import type { Page } from "@playwright/test";

/**
 * Keep every track that getUserMedia or getDisplayMedia returns, so a test can
 * check that a routine stopped its camera and microphone when it ended.
 * Install before page.goto.
 */
export async function installTrackRegister(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const opened: MediaStreamTrack[] = [];
    (window as unknown as { __ameTracks: MediaStreamTrack[] }).__ameTracks = opened;
    const devices = navigator.mediaDevices as unknown as Record<
      string,
      (constraints?: unknown) => Promise<MediaStream>
    >;
    for (const name of ["getUserMedia", "getDisplayMedia"]) {
      const original = devices[name]?.bind(navigator.mediaDevices);
      if (!original) continue;
      devices[name] = async (constraints?: unknown) => {
        const stream = await original(constraints);
        opened.push(...stream.getTracks());
        return stream;
      };
    }
  });
}

/** The kind ("audio" or "video") of each registered track that is not ended. */
export function liveTracks(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (window as unknown as { __ameTracks: MediaStreamTrack[] }).__ameTracks
      .filter((t) => t.readyState !== "ended")
      .map((t) => t.kind),
  );
}
