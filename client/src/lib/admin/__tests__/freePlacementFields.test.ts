import { describe, it, expect } from "vitest";
import { roundPct, formatPct, parsePct, correctedPctText } from "../freePlacementFields";

describe("roundPct", () => {
  it("rounds to one decimal place", () => {
    expect(roundPct(50)).toBe(50);
    expect(roundPct(33.333)).toBe(33.3);
    expect(roundPct(12.05)).toBeCloseTo(12.1, 5);
  });
});

describe("formatPct", () => {
  it("always shows one decimal place", () => {
    expect(formatPct(50)).toBe("50.0");
    expect(formatPct(33.333)).toBe("33.3");
    expect(formatPct(0)).toBe("0.0");
  });
});

describe("parsePct", () => {
  it("round-trips a typed whole number", () => {
    expect(parsePct("50")).toBe(50);
  });

  it("rounds a typed value to one decimal place", () => {
    expect(parsePct("33.333")).toBe(33.3);
  });

  it("returns null for blank text", () => {
    expect(parsePct("")).toBeNull();
    expect(parsePct("   ")).toBeNull();
  });

  it("returns null for text that is not a number", () => {
    expect(parsePct("abc")).toBeNull();
  });

  it("accepts a negative or over-100 value — clamping is the caller's job", () => {
    expect(parsePct("-5")).toBe(-5);
    expect(parsePct("150")).toBe(150);
  });
});

describe("correctedPctText", () => {
  it("leaves the field alone when the typed text already reads as accepted", () => {
    expect(correctedPctText("50.0", 50)).toBeNull();
    expect(correctedPctText(" 50.0 ", 50)).toBeNull();
  });

  it("forces the field to the formatted value otherwise", () => {
    expect(correctedPctText("50", 50)).toBe("50.0");
    expect(correctedPctText("abc", 12.34)).toBe("12.3");
  });
});
