import { describe, it, expect } from "vitest";
import type { FreePlacement } from "ame-shared";
import { resolveDrag } from "ame-shared/layout";

const at = (xPct: number, yPct: number, wPct = 20, hPct = 10): FreePlacement => ({
  xPct, yPct, wPct, hPct,
});

describe("resolveDrag", () => {
  it("moves the box to the pointer, keeping the grab offset", () => {
    const r = resolveDrag({
      pointerPct: { x: 50, y: 40 },
      grabOffsetPct: { x: 10, y: 5 },
      dragged: at(0, 0, 20, 10),
      others: [],
    });
    expect(r.placement.xPct).toBeCloseTo(40, 3);
    expect(r.placement.yPct).toBeCloseTo(35, 3);
    expect(r.valid).toBe(true);
  });

  it("clamps a drag that would leave the stage", () => {
    const r = resolveDrag({
      pointerPct: { x: 99, y: 99 },
      grabOffsetPct: { x: 0, y: 0 },
      dragged: at(0, 0, 20, 10),
      others: [],
    });
    expect(r.placement.xPct).toBeCloseTo(80, 3);
    expect(r.placement.yPct).toBeCloseTo(90, 3);
  });

  it("reports invalid when the result would overlap another element", () => {
    const r = resolveDrag({
      pointerPct: { x: 30, y: 0 },
      grabOffsetPct: { x: 0, y: 0 },
      dragged: at(0, 0, 20, 10),
      others: [at(35, 0, 20, 10)],
    });
    expect(r.valid).toBe(false);
  });

  it("snaps flush to a near neighbour's edge instead of overlapping it", () => {
    // Dragged left edge lands at 39; the neighbour's right edge is at 40.
    const r = resolveDrag({
      pointerPct: { x: 39, y: 0 },
      grabOffsetPct: { x: 0, y: 0 },
      dragged: at(0, 0, 20, 10),
      others: [at(20, 0, 20, 10)],
    });
    expect(r.placement.xPct).toBeCloseTo(40, 3);
    expect(r.valid).toBe(true);
  });

  it("emits a guide when an edge aligns with a neighbour's", () => {
    const r = resolveDrag({
      pointerPct: { x: 20.4, y: 30 },
      grabOffsetPct: { x: 0, y: 0 },
      dragged: at(0, 0, 20, 10),
      others: [at(20, 50, 20, 10)],
    });
    expect(r.placement.xPct).toBeCloseTo(20, 3);
    expect(r.guides.some((g) => g.axis === "x" && Math.abs(g.atPct - 20) < 0.001)).toBe(true);
  });

  it("snaps to the stage centre", () => {
    const r = resolveDrag({
      pointerPct: { x: 39.6, y: 44.7 },
      grabOffsetPct: { x: 0, y: 0 },
      dragged: at(0, 0, 20, 10),
      others: [],
    });
    expect(r.placement.xPct).toBeCloseTo(40, 3);
    expect(r.placement.yPct).toBeCloseTo(45, 3);
  });

  it("applies a grid snap when one is given", () => {
    const r = resolveDrag({
      pointerPct: { x: 23, y: 17 },
      grabOffsetPct: { x: 0, y: 0 },
      dragged: at(0, 0, 20, 10),
      others: [],
      snapPct: 5,
    });
    expect(r.placement.xPct).toBeCloseTo(25, 3);
    expect(r.placement.yPct).toBeCloseTo(15, 3);
  });

  it("ignores an element the caller excludes from collision", () => {
    // The dragged element must not collide with its own previous position.
    const r = resolveDrag({
      pointerPct: { x: 0, y: 0 },
      grabOffsetPct: { x: 0, y: 0 },
      dragged: at(0, 0, 20, 10),
      others: [],
    });
    expect(r.valid).toBe(true);
  });
});
