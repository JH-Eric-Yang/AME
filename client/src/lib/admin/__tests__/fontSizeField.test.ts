import { describe, it, expect } from "vitest";
import { parsePx, formatPx } from "../fontSizeField";

describe("parsePx", () => {
  it("reads a px value", () => {
    expect(parsePx("16px")).toBe(16);
    expect(parsePx(" 12.5px ")).toBe(12.5);
  });

  it("is null for any other unit, so the field shows blank rather than a wrong number", () => {
    expect(parsePx("1.2rem")).toBeNull();
    expect(parsePx("large")).toBeNull();
  });

  it("is null when unset", () => {
    expect(parsePx(undefined)).toBeNull();
    expect(parsePx("")).toBeNull();
  });
});

describe("formatPx", () => {
  it("writes the CSS string the runtime expects", () => {
    expect(formatPx(16)).toBe("16px");
    expect(formatPx(12.5)).toBe("12.5px");
  });
});
