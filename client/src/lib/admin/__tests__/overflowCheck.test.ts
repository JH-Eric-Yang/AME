import { describe, it, expect } from "vitest";
import { isOverflowing, OverflowTolerancePx } from "../overflowCheck";

describe("isOverflowing", () => {
  it("is false when content fits inside the box", () => {
    expect(isOverflowing(80, 100)).toBe(false);
  });

  it("is false when content exactly fills the box", () => {
    expect(isOverflowing(100, 100)).toBe(false);
  });

  it("is false for a sub-pixel rounding difference", () => {
    expect(isOverflowing(100 + OverflowTolerancePx, 100)).toBe(false);
  });

  it("is true once content clearly exceeds the box", () => {
    expect(isOverflowing(140, 100)).toBe(true);
  });

  it("is true just past the tolerance", () => {
    expect(isOverflowing(100 + OverflowTolerancePx + 0.01, 100)).toBe(true);
  });
});
