import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FreePlacement } from "ame-shared";
import { freeStyle, clampPlacement, overlaps, FreeMediaFitClass } from "ame-shared/layout";

const at = (xPct: number, yPct: number, wPct = 20, hPct = 10): FreePlacement => ({
  xPct, yPct, wPct, hPct,
});

describe("freeStyle", () => {
  it("positions absolutely in stage percentages", () => {
    expect(freeStyle(at(12, 8, 30, 9))).toEqual({
      position: "absolute",
      left: "12%",
      top: "8%",
      width: "30%",
      height: "9%",
      "box-sizing": "border-box",
      overflow: "hidden",
    });
  });

  /**
   * The Inspector tells a researcher that content taller than its box "will be
   * clipped for participants", and the canvas does clip it. Without this the
   * runtime spilled instead, over whatever neighbour sat below — which is the
   * builder/runtime disagreement this whole line of work exists to remove.
   */
  it("clips content to the authored box, which is what the builder promises", () => {
    expect(freeStyle(at(0, 0)).overflow).toBe("hidden");
  });
});

describe("FreeMediaFitClass", () => {
  /**
   * The class is declared in shared/ but implemented in a client stylesheet,
   * so the two can be renamed apart — and a free box that silently stopped
   * matching its own rule would go back to cropping stimuli with nothing to
   * show for it. This is the only place that can notice.
   */
  it("is the class the shared stylesheet actually styles", () => {
    const css = readFileSync(
      join(__dirname, "../../../client/src/lib/styles/freeMediaFit.css"),
      "utf8",
    );
    expect(css).toContain(`.${FreeMediaFitClass} `);
  });

  /** The two media wrappers it caps — the same pair `hasIntrinsicSize` names. */
  it("caps both media wrappers on both axes", () => {
    const css = readFileSync(
      join(__dirname, "../../../client/src/lib/styles/freeMediaFit.css"),
      "utf8",
    );
    expect(css).toContain(`.${FreeMediaFitClass} .el-image img`);
    expect(css).toContain(`.${FreeMediaFitClass} .el-video video`);
    expect(css).toContain("max-height: 100%");
    expect(css).toContain("max-width: 100%");
  });
});

describe("clampPlacement", () => {
  it("leaves a placement that is already on the stage", () => {
    const p = at(10, 10, 30, 20);
    expect(clampPlacement(p)).toEqual(p);
  });

  it("pulls a box back when it runs off the right or bottom edge", () => {
    expect(clampPlacement(at(90, 10, 30, 20))).toEqual(at(70, 10, 30, 20));
    expect(clampPlacement(at(10, 95, 30, 20))).toEqual(at(10, 80, 30, 20));
  });

  it("pulls a box back from negative coordinates", () => {
    expect(clampPlacement(at(-5, -12, 30, 20))).toEqual(at(0, 0, 30, 20));
  });

  it("shrinks a box too large for the stage rather than letting it overflow", () => {
    const huge = clampPlacement(at(0, 0, 150, 130));
    expect(huge.wPct).toBe(100);
    expect(huge.hPct).toBe(100);
    expect(huge.xPct).toBe(0);
    expect(huge.yPct).toBe(0);
  });

  it("is idempotent", () => {
    const once = clampPlacement(at(-20, 140, 160, 20));
    expect(clampPlacement(once)).toEqual(once);
  });
});

describe("overlaps", () => {
  it("is false for boxes that only share an edge", () => {
    // Edge snapping puts boxes flush; flush must not read as overlapping.
    expect(overlaps(at(0, 0, 20, 10), at(20, 0, 20, 10))).toBe(false);
    expect(overlaps(at(0, 0, 20, 10), at(0, 10, 20, 10))).toBe(false);
  });

  it("is true when boxes genuinely intersect", () => {
    expect(overlaps(at(0, 0, 20, 10), at(19, 9, 20, 10))).toBe(true);
  });

  it("is true when one box contains another", () => {
    expect(overlaps(at(0, 0, 50, 50), at(10, 10, 5, 5))).toBe(true);
  });

  it("is false for boxes that are far apart on either axis", () => {
    expect(overlaps(at(0, 0, 20, 10), at(60, 0, 20, 10))).toBe(false);
    expect(overlaps(at(0, 0, 20, 10), at(0, 60, 20, 10))).toBe(false);
  });

  it("is symmetric", () => {
    const a = at(0, 0, 30, 30);
    const b = at(10, 10, 30, 30);
    expect(overlaps(a, b)).toBe(overlaps(b, a));
  });
});
