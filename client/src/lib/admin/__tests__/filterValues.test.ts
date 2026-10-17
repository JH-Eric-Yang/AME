import { describe, it, expect } from "vitest";
import { parseFilterValue, formatFilterValue } from "../filterValues";

describe("parseFilterValue", () => {
  it("parses a quoted value as that exact string", () => {
    expect(parseFilterValue('"18"', "eq")).toBe("18");
    expect(parseFilterValue('"true"', "eq")).toBe("true");
    expect(parseFilterValue('"hello world"', "eq")).toBe("hello world");
  });

  it("parses true/false as booleans", () => {
    expect(parseFilterValue("true", "eq")).toBe(true);
    expect(parseFilterValue("false", "eq")).toBe(false);
  });

  it("parses numeric text as a number", () => {
    expect(parseFilterValue("18", "eq")).toBe(18);
    expect(parseFilterValue("-3.5", "eq")).toBe(-3.5);
  });

  it("keeps plain text as typed", () => {
    expect(parseFilterValue("yes", "eq")).toBe("yes");
  });

  it("splits an 'in' list, applying the single-value rule per item", () => {
    expect(parseFilterValue('a, "7", 7', "in")).toEqual(["a", "7", 7]);
  });
});

describe("formatFilterValue", () => {
  it("quotes a string that would otherwise parse as a number or boolean", () => {
    expect(formatFilterValue("18")).toBe('"18"');
    expect(formatFilterValue("true")).toBe('"true"');
  });

  it("formats an empty string as empty, not as a quoted empty string", () => {
    expect(formatFilterValue("")).toBe("");
  });

  it("leaves plain text unquoted", () => {
    expect(formatFilterValue("yes")).toBe("yes");
  });

  it("formats numbers and booleans via String", () => {
    expect(formatFilterValue(18)).toBe("18");
    expect(formatFilterValue(true)).toBe("true");
  });

  it("formats null/undefined as an empty string", () => {
    expect(formatFilterValue(null)).toBe("");
    expect(formatFilterValue(undefined)).toBe("");
  });

  it("joins array items with ', ' after formatting each one", () => {
    expect(formatFilterValue(["a", "7", 7])).toBe('a, "7", 7');
  });
});

describe("round trip", () => {
  const cases: unknown[] = ["18", 18, "true", true, "yes"];

  it.each(cases)("parseFilterValue(formatFilterValue(%j)) equals the original", (value) => {
    expect(parseFilterValue(formatFilterValue(value), "eq")).toEqual(value);
  });

  it("round-trips an 'in' array of mixed types", () => {
    const value = ["a", "7", 7];
    expect(parseFilterValue(formatFilterValue(value), "in")).toEqual(value);
  });

  it("round-trips the empty string", () => {
    expect(formatFilterValue("")).toBe("");
    expect(parseFilterValue(formatFilterValue(""), "eq")).toBe("");
  });

  it("does not accumulate quotes when typing continues after an empty box", () => {
    expect(parseFilterValue(formatFilterValue("") + "18", "eq")).toBe(18);
    expect(parseFilterValue(formatFilterValue("") + "yes", "eq")).toBe("yes");
  });
});
