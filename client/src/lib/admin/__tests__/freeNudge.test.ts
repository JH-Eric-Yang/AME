import { describe, it, expect } from "vitest";
import { nudgePlacement, NudgeStepPct, NudgeStepFastPct } from "../freeNudge";

const at = (xPct: number, yPct: number) => ({ xPct, yPct, wPct: 20, hPct: 10 });

describe("nudgePlacement", () => {
  it("moves left by the plain step", () => {
    const p = nudgePlacement(at(50, 50), "ArrowLeft", false);
    expect(p?.xPct).toBeCloseTo(50 - NudgeStepPct, 5);
    expect(p?.yPct).toBeCloseTo(50, 5);
  });

  it("moves right by the plain step", () => {
    expect(nudgePlacement(at(50, 50), "ArrowRight", false)?.xPct).toBeCloseTo(50 + NudgeStepPct, 5);
  });

  it("moves up and down on the y axis only", () => {
    expect(nudgePlacement(at(50, 50), "ArrowUp", false)).toEqual({ ...at(50, 50), yPct: 50 - NudgeStepPct });
    expect(nudgePlacement(at(50, 50), "ArrowDown", false)).toEqual({ ...at(50, 50), yPct: 50 + NudgeStepPct });
  });

  it("uses the fast step when shift is held", () => {
    expect(nudgePlacement(at(50, 50), "ArrowRight", true)?.xPct).toBeCloseTo(50 + NudgeStepFastPct, 5);
  });

  it("preserves width and height", () => {
    const p = nudgePlacement({ xPct: 10, yPct: 10, wPct: 33.3, hPct: 12.5 }, "ArrowDown", false);
    expect(p?.wPct).toBe(33.3);
    expect(p?.hPct).toBe(12.5);
  });

  it("returns null for a key that is not an arrow key", () => {
    expect(nudgePlacement(at(50, 50), "Enter", false)).toBeNull();
    expect(nudgePlacement(at(50, 50), "a", false)).toBeNull();
  });

  it("does not clamp — that is the caller's job via clampPlacement", () => {
    const p = nudgePlacement(at(0, 0), "ArrowLeft", false);
    expect(p?.xPct).toBeCloseTo(-NudgeStepPct, 5);
  });
});
