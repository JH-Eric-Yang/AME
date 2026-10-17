import { describe, it, expect } from "vitest";
import type { ElementConfig, FreePlacement } from "ame-shared";
import {
  hasIntrinsicSize,
  aspectLocked,
  naturalAspectScale,
  conformsToAspect,
  conformPlacement,
  conformTarget,
  containSize,
  describeNaturalSize,
  DefaultFreePlacement,
  stageSize,
} from "ame-shared/layout";

const Stage169 = stageSize("16:9");

const el = (over: Partial<ElementConfig> = {}): ElementConfig => ({
  name: "el",
  type: "image",
  params: {},
  ...over,
});

const at = (wPct: number, hPct: number, xPct = 0, yPct = 0): FreePlacement => ({
  xPct,
  yPct,
  wPct,
  hPct,
});

describe("hasIntrinsicSize", () => {
  it("covers the types that paint media with a size of their own", () => {
    expect(hasIntrinsicSize("image")).toBe(true);
    expect(hasIntrinsicSize("video")).toBe(true);
  });

  it("excludes types with no shape to follow", () => {
    expect(hasIntrinsicSize("text")).toBe(false);
    expect(hasIntrinsicSize("survey")).toBe(false);
    // Its height is the browser's controls bar, not the medium's.
    expect(hasIntrinsicSize("audio")).toBe(false);
  });
});

describe("aspectLocked", () => {
  /**
   * The default rule is the whole reason the field is optional: an image
   * placed before the field existed must still behave like an image.
   */
  it("locks the intrinsically sized types when the field is absent", () => {
    expect(aspectLocked(el({ type: "image" }))).toBe(true);
    expect(aspectLocked(el({ type: "video" }))).toBe(true);
  });

  it("leaves everything else free when the field is absent", () => {
    expect(aspectLocked(el({ type: "text" }))).toBe(false);
    expect(aspectLocked(el({ type: "button" }))).toBe(false);
  });

  it("obeys an explicit choice in both directions", () => {
    expect(aspectLocked(el({ type: "image", lockAspect: false }))).toBe(false);
    expect(aspectLocked(el({ type: "text", lockAspect: true }))).toBe(true);
  });
});

describe("naturalAspectScale", () => {
  /**
   * Percentages are of different pixel extents on each axis, so a square image
   * is NOT wPct === hPct: on 1280x720 it needs hPct = wPct * 16/9.
   */
  it("converts a pixel ratio into the stage's percentage units", () => {
    expect(naturalAspectScale({ width: 100, height: 100 }, Stage169)).toBeCloseTo(1280 / 720, 6);
    expect(naturalAspectScale({ width: 1280, height: 720 }, Stage169)).toBeCloseTo(1, 6);
    expect(naturalAspectScale({ width: 800, height: 600 }, Stage169)).toBeCloseTo(
      (600 / 800) * (1280 / 720),
      6,
    );
  });

  /** Every "the media never loaded" case arrives as a zero, a NaN or a null. */
  it("has no answer when the media or the stage is unknown", () => {
    expect(naturalAspectScale(null, Stage169)).toBeNull();
    expect(naturalAspectScale({ width: 800, height: 600 }, null)).toBeNull();
    expect(naturalAspectScale({ width: 0, height: 0 }, Stage169)).toBeNull();
    expect(naturalAspectScale({ width: 800, height: Number.NaN }, Stage169)).toBeNull();
  });
});

describe("conformPlacement", () => {
  const scale = naturalAspectScale({ width: 800, height: 600 }, Stage169) as number;

  it("keeps the authored width and derives the height", () => {
    const conformed = conformPlacement(at(40, 15, 10, 10), scale);
    expect(conformed.wPct).toBe(40);
    expect(conformed.xPct).toBe(10);
    expect(conformed.yPct).toBe(10);
    expect(conformed.hPct).toBeCloseTo(40 * scale, 2);
  });

  /** The point of the whole exercise: the box's PIXEL ratio matches the file's. */
  it("gives the box the medium's true pixel ratio", () => {
    const conformed = conformPlacement(at(40, 15), scale);
    const pxWidth = (conformed.wPct / 100) * Stage169.width;
    const pxHeight = (conformed.hPct / 100) * Stage169.height;
    expect(pxWidth / pxHeight).toBeCloseTo(800 / 600, 2);
  });

  it("shapes different media differently — the bug this fixes", () => {
    const wide = naturalAspectScale({ width: 1920, height: 1080 }, Stage169) as number;
    const tall = naturalAspectScale({ width: 600, height: 800 }, Stage169) as number;
    expect(conformPlacement(at(30, 15), wide).hPct).not.toBeCloseTo(
      conformPlacement(at(30, 15), tall).hPct,
      1,
    );
  });

  it("is idempotent, so a written value cannot re-trigger a write", () => {
    const once = conformPlacement(at(37.4, 15, 3, 4), scale);
    const twice = conformPlacement(once, scale);
    expect(twice).toEqual(once);
    expect(conformsToAspect(once, scale)).toBe(true);
  });

  it("keeps the ratio when the derived height would leave the stage", () => {
    const square = naturalAspectScale({ width: 100, height: 100 }, Stage169) as number;
    const conformed = conformPlacement(at(90, 10), square);
    expect(conformed.hPct).toBeLessThanOrEqual(100);
    expect(conformsToAspect(conformed, square)).toBe(true);
  });

  it("clamps back onto the stage rather than hanging off the bottom", () => {
    const conformed = conformPlacement(at(60, 10, 0, 95), scale);
    expect(conformed.yPct + conformed.hPct).toBeLessThanOrEqual(100.001);
    expect(conformsToAspect(conformed, scale)).toBe(true);
  });
});

describe("conformsToAspect", () => {
  const scale = naturalAspectScale({ width: 1280, height: 720 }, Stage169) as number;

  it("accepts a box already at the ratio", () => {
    expect(conformsToAspect(at(30, 30), scale)).toBe(true);
  });

  it("rejects the arbitrary default box an element used to get", () => {
    expect(conformsToAspect(DefaultFreePlacement, scale)).toBe(false);
  });

  it("tolerates rounding, which is what stops a write loop", () => {
    expect(conformsToAspect(at(30, 30.02), scale)).toBe(true);
  });
});

describe("conformTarget", () => {
  const natural = { width: 800, height: 600 };
  const placed = (over: Partial<ElementConfig> = {}) =>
    el({ placement: at(30, 15), ...over });

  it("reshapes a locked element whose box has the wrong shape", () => {
    const target = conformTarget(placed(), natural, Stage169);
    expect(target).not.toBeNull();
    expect(target!.wPct).toBe(30);
    expect(target!.hPct).toBeCloseTo(30 * (600 / 800) * (1280 / 720), 2);
  });

  /** Each of these is a separate way to mean "leave the box alone". */
  it("leaves an unlocked element alone", () => {
    expect(conformTarget(placed({ lockAspect: false }), natural, Stage169)).toBeNull();
  });

  it("leaves a type with nothing to lock to alone", () => {
    expect(conformTarget(placed({ type: "text" }), natural, Stage169)).toBeNull();
  });

  it("leaves an element alone when the media never loaded", () => {
    expect(conformTarget(placed(), null, Stage169)).toBeNull();
    expect(conformTarget(placed(), { width: 0, height: 0 }, Stage169)).toBeNull();
  });

  it("leaves an element alone on a stage with no locked ratio", () => {
    expect(conformTarget(placed(), natural, null)).toBeNull();
  });

  it("leaves an element with no placement alone", () => {
    expect(conformTarget(el(), natural, Stage169)).toBeNull();
  });

  /**
   * The loop guard, stated as a property: whatever this returns must itself
   * return null when it comes back as the element's placement.
   */
  it("has nothing left to do once its own answer is applied", () => {
    const first = conformTarget(placed(), natural, Stage169) as FreePlacement;
    expect(conformTarget(placed({ placement: first }), natural, Stage169)).toBeNull();
  });
});

describe("containSize", () => {
  /**
   * The measured case that motivated the rule: a 400x400 stimulus in a box
   * 125x42 CSS pixels used to render 118x118 with 76px cut off by the free
   * box's `overflow: hidden`. Fitted, it is 42x42 and whole.
   */
  it("fits media into a box far shorter than itself", () => {
    expect(containSize({ width: 400, height: 400 }, { width: 125, height: 42 })).toEqual({
      width: 42,
      height: 42,
    });
  });

  it("is bound by whichever axis binds first", () => {
    expect(containSize({ width: 800, height: 400 }, { width: 200, height: 400 })).toEqual({
      width: 200,
      height: 100,
    });
    expect(containSize({ width: 400, height: 800 }, { width: 400, height: 200 })).toEqual({
      width: 100,
      height: 200,
    });
  });

  it("keeps the media's aspect ratio", () => {
    const fitted = containSize({ width: 1920, height: 1080 }, { width: 300, height: 300 });
    expect(fitted.width / fitted.height).toBeCloseTo(1920 / 1080, 10);
  });

  /** max-width/max-height only shrink, so neither does this. */
  it("leaves media smaller than its box at its own size", () => {
    expect(containSize({ width: 100, height: 50 }, { width: 400, height: 400 })).toEqual({
      width: 100,
      height: 50,
    });
  });

  it("always lands inside the box on both axes", () => {
    const box = { width: 125, height: 42 };
    for (const natural of [
      { width: 400, height: 400 },
      { width: 1920, height: 1080 },
      { width: 3, height: 900 },
      { width: 900, height: 3 },
    ]) {
      const fitted = containSize(natural, box);
      expect(fitted.width).toBeLessThanOrEqual(box.width);
      expect(fitted.height).toBeLessThanOrEqual(box.height);
    }
  });

  /** A box or a medium with no size yet answers nothing, like the rest of this module. */
  it("answers zero rather than a NaN when either size is unusable", () => {
    expect(containSize({ width: 0, height: 0 }, { width: 100, height: 100 })).toEqual({
      width: 0,
      height: 0,
    });
    expect(containSize({ width: 100, height: 100 }, { width: 0, height: 100 })).toEqual({
      width: 0,
      height: 0,
    });
  });

  /**
   * The tie between the two rules: a box that `conformsToAspect` says already
   * has the media's shape has no bands, which is exactly when the Inspector
   * stays quiet.
   */
  it("fills a conforming box exactly", () => {
    const scale = naturalAspectScale({ width: 400, height: 400 }, Stage169) as number;
    const conformed = conformPlacement(at(20, 5), scale);
    const box = {
      width: (conformed.wPct / 100) * Stage169.width,
      height: (conformed.hPct / 100) * Stage169.height,
    };
    const fitted = containSize({ width: 400, height: 400 }, box);
    expect(fitted.width).toBeCloseTo(box.width, 1);
    expect(fitted.height).toBeCloseTo(box.height, 1);
  });
});

describe("describeNaturalSize", () => {
  it("reduces to a ratio a researcher recognises", () => {
    expect(describeNaturalSize({ width: 800, height: 600 })).toBe("800×600 (4:3)");
    expect(describeNaturalSize({ width: 1920, height: 1080 })).toBe("1920×1080 (16:9)");
  });

  it("falls back to a decimal when the reduction says nothing", () => {
    expect(describeNaturalSize({ width: 1921, height: 1080 })).toBe("1921×1080 (1.78:1)");
  });
});

describe("DefaultFreePlacement", () => {
  it("is the one declaration both authoring paths read", () => {
    expect(DefaultFreePlacement).toEqual({ xPct: 0, yPct: 0, wPct: 30, hPct: 15 });
  });
});
