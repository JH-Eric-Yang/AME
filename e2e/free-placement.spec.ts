import { test, expect, type Page } from "@playwright/test";
import {
  seedFreePlacementExperiment,
  deleteFreePlacementExperiment,
  disconnect,
  SquareStimulusPx,
} from "./fixtures/seed";

let experimentId: string;

test.beforeAll(async () => {
  experimentId = await seedFreePlacementExperiment();
});

test.afterAll(async () => {
  await deleteFreePlacementExperiment();
  await disconnect();
});

/**
 * Matches the `startExperiment`/`enterExperiment` helper in the other e2e
 * specs: the lobby requires two clicks before the first routine mounts.
 */
async function enterExperiment(page: Page): Promise<void> {
  await page.goto(`/experiment/${experimentId}`);
  await page.getByRole("button", { name: "Begin Experiment" }).click();
  await page.getByRole("button", { name: "I'm Ready" }).click();
}

/**
 * The authored stage percentage for each element, measured against the
 * *stage rect* — never the viewport — because the stage is centred and
 * letterboxed inside it. `.stage` is the fixed-size box LayoutStage.svelte
 * lays out at 1280x720 and then visually scales; measuring against it is what
 * makes the assertion independent of window size.
 */
async function measure(page: Page, text: string) {
  // Both rects in ONE evaluate, so they are measured in the same frame. Two
  // separate boundingBox() round trips can straddle a pending resize —
  // the stage is rescaled by a ResizeObserver, so for a frame after
  // setViewportSize the stage still holds its old scale — and mixing a stale
  // stage rect with a fresh element rect reports a position neither ever had.
  return page.getByText(text).evaluate((el) => {
    const stage = document.querySelector(".stage");
    if (!stage) throw new Error("The stage must be laid out");
    const s = stage.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    return {
      xPct: ((e.x - s.x) / s.width) * 100,
      yPct: ((e.y - s.y) / s.height) * 100,
      wPct: (e.width / s.width) * 100,
      hPct: (e.height / s.height) * 100,
    };
  });
}

test("a free-mode element renders at its authored stage percentage", async ({ page }) => {
  await enterExperiment(page);

  const stimulus = await measure(page, "Free stimulus WYSIWYG target");
  expect(stimulus.xPct).toBeCloseTo(12, 0);
  expect(stimulus.yPct).toBeCloseTo(8, 0);

  const second = await measure(page, "Second free-placement corroboration target");
  expect(second.xPct).toBeCloseTo(55, 0);
  expect(second.yPct).toBeCloseTo(62, 0);
});

test("the authored percentages are identical at two viewport sizes", async ({ page }) => {
  // Height-bound at 1280x720 (the stage's own native size, scale 1) and
  // width-bound at 1920x1080 (scale 1.5) — two genuinely different fits, not
  // just two different windows, so agreement here rules out coincidence.
  await page.setViewportSize({ width: 1280, height: 720 });
  await enterExperiment(page);
  const small = await measure(page, "Free stimulus WYSIWYG target");

  await page.setViewportSize({ width: 1920, height: 1080 });
  const large = await measure(page, "Free stimulus WYSIWYG target");

  expect(large.xPct).toBeCloseTo(small.xPct, 0);
  expect(large.yPct).toBeCloseTo(small.yPct, 0);
  expect(large.wPct).toBeCloseTo(small.wPct, 0);
  expect(large.hPct).toBeCloseTo(small.hPct, 0);

  // And both agree with what was actually authored.
  expect(small.xPct).toBeCloseTo(12, 0);
  expect(small.yPct).toBeCloseTo(8, 0);
  expect(large.xPct).toBeCloseTo(12, 0);
  expect(large.yPct).toBeCloseTo(8, 0);
});

/**
 * The two tests above normalise against `.stage`'s own post-transform rect, so
 * they pass whatever the frame around it does. This one measures the frame.
 *
 * A locked stage lays out at 1280x720 and is only visually scaled, and a
 * transform does not change a layout box: a frame sized to the UNSCALED stage
 * reserves and scrolls the full 1280x720 at every scale. Worse, a frame whose
 * height is only `min-height` is sized BY that unscaled child, so the height
 * fed into fitStage can never be less than the stage's own and the stage never
 * scales down to a short window.
 *
 * 1400x500 is wide enough for the stage but 220px too short, so the fit here
 * is height-bound: the stage must end up exactly as tall as its frame. That
 * only holds if the frame's height is its own.
 */
test("the stage scales to fit a frame shorter than the stage", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 500 });
  await enterExperiment(page);

  const box = await page.locator(".stage-frame").evaluate((frame) => {
    const stage = frame.querySelector(".stage")!.getBoundingClientRect();
    const rect = frame.getBoundingClientRect();
    return {
      stage: { width: stage.width, height: stage.height },
      frame: { width: rect.width, height: rect.height },
      scrollWidth: frame.scrollWidth,
      clientWidth: frame.clientWidth,
      scrollHeight: frame.scrollHeight,
      clientHeight: frame.clientHeight,
    };
  });

  // The frame is the window, not the stage: it does not reserve 720px of
  // height inside a 500px window because its unscaled child is that tall.
  expect(box.frame.height).toBeLessThanOrEqual(500);

  // Never larger than the frame on either axis.
  expect(box.stage.width).toBeLessThanOrEqual(box.frame.width + 1);
  expect(box.stage.height).toBeLessThanOrEqual(box.frame.height + 1);

  // Height-bound, so it fills the height exactly: it scaled to fit rather than
  // bottoming out at MinStageScale on a frame it had sized itself.
  expect(box.stage.height).toBeCloseTo(box.frame.height, 0);
  // And it really is scaled down, not clipped.
  expect(box.stage.width).toBeLessThan(1280);

  // The frame reserves no space beyond what it can show: no dead scroll area.
  expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
  expect(box.scrollHeight).toBeLessThanOrEqual(box.clientHeight);
});

/**
 * The free box's `overflow: hidden` must never take part of a stimulus away.
 *
 * The box is the authored stimulus AREA; the medium letterboxes inside it.
 * Before `FreeMediaFitClass` the <img> rendered at its natural size — ElImage's
 * `object-fit` is inert while width and height are both `auto` — and the box
 * clipped the remainder, so a participant saw a slice of the image and nothing
 * anywhere recorded that they had.
 *
 * Measured against the rendered <img> rect, not against CSS: the fix depends on
 * a percentage `max-height` resolving through every wrapper between the box and
 * the media, and a wrapper added later without a matching line in
 * freeMediaFit.css would put the cropping back with no other symptom.
 */
async function measureImage(page: Page, alt: string) {
  return page.getByAltText(alt, { exact: true }).evaluate((img) => {
    const box = img.closest("div[style*='position: absolute']")!.getBoundingClientRect();
    const rect = img.getBoundingClientRect();
    return {
      box: { width: box.width, height: box.height },
      img: { width: rect.width, height: rect.height },
      // Slack of a pixel: sub-pixel layout, not a slice of stimulus.
      insideX: rect.left >= box.left - 1 && rect.right <= box.right + 1,
      insideY: rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1,
    };
  });
}

test("an unlocked stimulus fits inside its box instead of being cropped by it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await enterExperiment(page);

  const m = await measureImage(page, "Free stimulus in an unlocked box");

  // The box really is the wrong shape for the medium — otherwise this test
  // would pass on a square box and prove nothing.
  expect(m.box.width).toBeGreaterThan(m.box.height * 2);

  // Wholly inside its box on BOTH axes. This is the assertion that fails when
  // the stimulus is being clipped.
  expect(m.insideX).toBe(true);
  expect(m.insideY).toBe(true);
  expect(m.img.width).toBeLessThanOrEqual(m.box.width + 1);
  expect(m.img.height).toBeLessThanOrEqual(m.box.height + 1);

  // Still the medium's own shape: fitted, not squashed to the box.
  expect(m.img.width / m.img.height).toBeCloseTo(1, 1);

  // Height-bound, so the fit uses the whole height and nothing more.
  expect(m.img.height).toBeCloseTo(m.box.height, 0);
  // And it is genuinely scaled down from its natural size rather than clipped.
  expect(m.img.height).toBeLessThan(SquareStimulusPx);
});

/**
 * The other half of the same rule: a locked box already has its medium's shape,
 * so the fit must be a no-op there. If `max-width`/`max-height` had been
 * anything more forceful, this is where a locked stimulus would have started
 * showing bands it never had.
 */
test("a locked stimulus still fills its box exactly", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await enterExperiment(page);

  const m = await measureImage(page, "Free stimulus in a box locked to it");

  expect(m.box.width).toBeCloseTo(m.box.height, 0);
  expect(m.img.width).toBeCloseTo(m.box.width, 0);
  expect(m.img.height).toBeCloseTo(m.box.height, 0);
  expect(m.insideX).toBe(true);
  expect(m.insideY).toBe(true);
});
