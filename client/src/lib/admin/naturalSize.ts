/**
 * naturalSize — what size a stimulus actually is, measured in the browser.
 *
 * The Asset row stores bytes, a filename and a mimetype, but no dimensions, so
 * there is nothing on the server to ask. The browser is the only thing that
 * knows, and it only knows once the medium has loaded.
 *
 * Measuring is deliberately NOT done by reaching into the `<img>` the canvas
 * mounts. That element belongs to ElImage, appears only after ElementRenderer's
 * dynamic import resolves, and exists only for elements the canvas is currently
 * showing — while the Inspector needs the same number for whichever element is
 * selected. So a URL is loaded once, off-DOM, and the answer is cached for
 * every reader. Images cost nothing extra: the canvas has already requested the
 * same URL, so this is served from the browser's cache.
 */

import { writable } from "svelte/store";
import type { ElementConfig } from "ame-shared";
import type { NaturalSize } from "ame-shared/layout";
import { resolveSrc } from "$lib/media/assetSrc";

/** Which tag can report a size for a medium. */
export type MediaKind = "image" | "video";

/**
 * Loads a URL far enough to report its dimensions, or resolves null if it
 * never gets there.
 *
 * Injected so the cache can be tested without a DOM — the client suite has no
 * jsdom, and this module's decisions (dedupe, cache, give up) are the part
 * worth testing.
 */
export type SizeLoader = (url: string, kind: MediaKind) => Promise<NaturalSize | null>;

/**
 * Measurements so far, keyed by resolved URL.
 *
 * Keyed by URL rather than by element so that two elements showing the same
 * asset — a common way to build a comparison screen — measure it once.
 *
 * A URL that failed is recorded as `null` rather than left absent, so a reader
 * can tell "not measured yet" from "cannot be measured" and say something
 * honest about each. Both mean the same thing to the geometry: leave the box
 * alone.
 */
const sizes = writable<Record<string, NaturalSize | null>>({});

export const naturalSizes = { subscribe: sizes.subscribe };

/**
 * URLs already asked about, successfully or not.
 *
 * A failure is remembered as firmly as a success: a missing asset answers 404
 * every time, and retrying on every render would put the canvas in a request
 * loop for a stimulus the researcher has yet to upload.
 */
const asked = new Set<string>();

/** The URL an element's medium loads from, or null when it has none yet. */
export function mediaUrl(el: ElementConfig): string | null {
  const src = (el.params as Record<string, unknown>).src;
  if (typeof src !== "string") return null;
  return resolveSrc(src) || null;
}

/** Reset between tests; not part of the runtime path. */
export function resetNaturalSizes(): void {
  asked.clear();
  sizes.set({});
}

/**
 * A medium loaded only far enough to be measured.
 *
 * `<img>` reports `naturalWidth`/`naturalHeight` on `load`; `<video>` reports
 * `videoWidth`/`videoHeight` on `loadedmetadata`, which needs only the head of
 * the file. Both resolve null on `error`, and a zero dimension is treated as no
 * answer rather than a box of no height.
 */
const loadInBrowser: SizeLoader = (url, kind) =>
  new Promise((resolve) => {
    const done = (width: number, height: number) =>
      resolve(width > 0 && height > 0 ? { width, height } : null);

    if (kind === "image") {
      const img = new Image();
      img.onload = () => done(img.naturalWidth, img.naturalHeight);
      img.onerror = () => resolve(null);
      img.src = url;
      return;
    }

    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => done(video.videoWidth, video.videoHeight);
    video.onerror = () => resolve(null);
    video.src = url;
  });

/**
 * Measure a URL if it has not been measured already.
 *
 * Idempotent and fire-and-forget: callers ask on every render and the store
 * answers when — or if — the browser does.
 */
export function measureNaturalSize(
  url: string,
  kind: MediaKind,
  load: SizeLoader = loadInBrowser,
): void {
  if (!url || asked.has(url)) return;
  asked.add(url);
  void load(url, kind).then((size) => {
    sizes.update((current) => ({ ...current, [url]: size }));
  });
}
