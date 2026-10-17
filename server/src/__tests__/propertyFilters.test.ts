import { describe, it, expect } from "vitest";
import { evaluateFilter, evaluateFilters } from "ame-shared/propertyFilters";

describe("evaluateFilter", () => {
  const props = { age: 25, language: "english", score: 7.5 };

  it("eq: matches equal values", () => {
    expect(
      evaluateFilter(props, {
        property: "language",
        operator: "eq",
        value: "english",
      }),
    ).toBe(true);
    expect(
      evaluateFilter(props, {
        property: "language",
        operator: "eq",
        value: "spanish",
      }),
    ).toBe(false);
  });

  it("neq: matches non-equal values", () => {
    expect(
      evaluateFilter(props, {
        property: "language",
        operator: "neq",
        value: "spanish",
      }),
    ).toBe(true);
    expect(
      evaluateFilter(props, {
        property: "language",
        operator: "neq",
        value: "english",
      }),
    ).toBe(false);
  });

  it("gt/lt/gte/lte: numeric comparisons", () => {
    expect(
      evaluateFilter(props, { property: "age", operator: "gt", value: 20 }),
    ).toBe(true);
    expect(
      evaluateFilter(props, { property: "age", operator: "gt", value: 25 }),
    ).toBe(false);
    expect(
      evaluateFilter(props, { property: "age", operator: "gte", value: 25 }),
    ).toBe(true);
    expect(
      evaluateFilter(props, { property: "age", operator: "lt", value: 30 }),
    ).toBe(true);
    expect(
      evaluateFilter(props, { property: "age", operator: "lte", value: 25 }),
    ).toBe(true);
  });

  it("in: checks value membership in array", () => {
    expect(
      evaluateFilter(props, {
        property: "language",
        operator: "in",
        value: ["english", "spanish"],
      }),
    ).toBe(true);
    expect(
      evaluateFilter(props, {
        property: "language",
        operator: "in",
        value: ["french", "german"],
      }),
    ).toBe(false);
  });

  it("returns false for missing properties", () => {
    expect(
      evaluateFilter(props, {
        property: "missing",
        operator: "eq",
        value: "x",
      }),
    ).toBe(false);
  });

  it("returns false for non-numeric value with numeric operator", () => {
    expect(
      evaluateFilter(props, {
        property: "language",
        operator: "gt",
        value: 5,
      }),
    ).toBe(false);
  });
});

describe("evaluateFilters", () => {
  it("returns true when all filters match (AND logic)", () => {
    const props = { language: "english", age: 25 };
    const filters = [
      { property: "language", operator: "eq" as const, value: "english" },
      { property: "age", operator: "gte" as const, value: 18 },
    ];
    expect(evaluateFilters(props, filters)).toBe(true);
  });

  it("returns false when any filter fails", () => {
    const props = { language: "english", age: 15 };
    const filters = [
      { property: "language", operator: "eq" as const, value: "english" },
      { property: "age", operator: "gte" as const, value: 18 },
    ];
    expect(evaluateFilters(props, filters)).toBe(false);
  });

  it("returns true for empty filters array", () => {
    expect(evaluateFilters({ x: 1 }, [])).toBe(true);
  });
});
