import { describe, it, expect } from "vitest";
import { stageSize, fitStage, fitStageWidth, MinStageScale } from "ame-shared/layout";

describe("stageSize", () => {
  it("gives each ratio its fixed internal pixel size", () => {
    expect(stageSize("16:9")).toEqual({ width: 1280, height: 720 });
    expect(stageSize("4:3")).toEqual({ width: 1024, height: 768 });
    expect(stageSize("device")).toEqual({ width: 390, height: 844 });
  });

  it("keeps each size true to its named ratio", () => {
    const wide = stageSize("16:9");
    expect(wide.width / wide.height).toBeCloseTo(16 / 9, 3);
    const classic = stageSize("4:3");
    expect(classic.width / classic.height).toBeCloseTo(4 / 3, 3);
  });
});

describe("fitStage", () => {
  it("scales down to fit a viewport narrower than the stage", () => {
    const fit = fitStage("16:9", { width: 640, height: 1000 });
    expect(fit.scale).toBeCloseTo(0.5, 3);
    expect(fit.width).toBeCloseTo(640, 0);
    expect(fit.height).toBeCloseTo(360, 0);
  });

  it("is limited by whichever viewport axis is tighter", () => {
    // Height-bound: 360/720 = 0.5 is tighter than 1920/1280 = 1.5.
    expect(fitStage("16:9", { width: 1920, height: 360 }).scale).toBeCloseTo(0.5, 3);
  });

  it("scales up to fill a viewport larger than the stage", () => {
    expect(fitStage("16:9", { width: 2560, height: 1440 }).scale).toBeCloseTo(2, 3);
  });

  it("never shrinks past the floor where authored text stops being legible", () => {
    const fit = fitStage("16:9", { width: 320, height: 200 });
    expect(fit.scale).toBe(MinStageScale);
  });

  it("returns the scaled box, so a caller can centre and letterbox it", () => {
    const fit = fitStage("4:3", { width: 512, height: 768 });
    expect(fit.scale).toBeCloseTo(0.5, 3);
    expect(fit.width).toBeCloseTo(512, 0);
    expect(fit.height).toBeCloseTo(384, 0);
  });

  /**
   * The returned box is the whole point: a caller that sizes its frame to the
   * UNSCALED stage instead reserves and scrolls 1280x720 at every scale. So
   * the box never exceeds the viewport it was fitted to, except at the
   * MinStageScale floor, where a participant scrolls on purpose.
   */
  it("gives a box that fits inside the viewport at every scale above the floor", () => {
    for (const viewport of [
      { width: 1000, height: 500 },
      { width: 1920, height: 1080 },
      { width: 1280, height: 720 },
      { width: 800, height: 1400 },
      { width: 2560, height: 700 },
    ]) {
      const fit = fitStage("16:9", viewport);
      expect(fit.scale).toBeGreaterThan(MinStageScale);
      expect(fit.width).toBeLessThanOrEqual(viewport.width);
      expect(fit.height).toBeLessThanOrEqual(viewport.height);
    }
  });
});

describe("fitStageWidth", () => {
  it("fits the width and lets the height fall where it may", () => {
    const fit = fitStageWidth("16:9", 640);
    expect(fit.scale).toBeCloseTo(0.5, 3);
    expect(fit.width).toBeCloseTo(640, 0);
    expect(fit.height).toBeCloseTo(360, 0);
  });

  it("ignores height entirely: a tall stage in a narrow panel still fits the width", () => {
    // "device" is 390x844 — taller than wide, so a height bound would dominate.
    const fit = fitStageWidth("device", 780);
    expect(fit.scale).toBeCloseTo(2, 3);
    expect(fit.height).toBeCloseTo(1688, 0);
  });

  /**
   * The opposite of the runtime rule, on purpose. The builder's stage is a
   * preview inside a fixed-width column: it has to fit that column at any
   * width, and MinStageScale pinned a 16:9 stage at 640px wide however narrow
   * the panel got, so it overflowed instead.
   */
  it("fits a panel narrower than the runtime legibility floor allows", () => {
    // The measured builder centre panel at a 1440px window.
    const fit = fitStageWidth("16:9", 624);
    expect(fit.scale).toBeLessThan(MinStageScale);
    expect(fit.width).toBeLessThanOrEqual(624);
    expect(fit.height).toBeCloseTo(351, 0);
  });

  it("fits every panel width, however narrow", () => {
    for (const width of [1200, 900, 624, 480, 320, 100]) {
      expect(fitStageWidth("16:9", width).width).toBeLessThanOrEqual(width);
      expect(fitStageWidth("device", width).width).toBeLessThanOrEqual(width);
    }
  });
});

describe("fitStage minScale option", () => {
  it("floors at MinStageScale by default — the runtime path", () => {
    expect(fitStage("16:9", { width: 100, height: 100 }).scale).toBe(MinStageScale);
    expect(fitStage("16:9", { width: 624, height: Number.POSITIVE_INFINITY }).scale).toBe(
      MinStageScale,
    );
  });

  it("honours an explicit floor below the default", () => {
    const fit = fitStage("16:9", { width: 624, height: Number.POSITIVE_INFINITY }, { minScale: 0 });
    expect(fit.scale).toBeCloseTo(624 / 1280, 5);
  });

  it("honours an explicit floor above the default", () => {
    expect(fitStage("16:9", { width: 320, height: 200 }, { minScale: 1 }).scale).toBe(1);
  });
});
