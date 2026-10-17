import { describe, it, expect } from "vitest";
import { evaluateFilters } from "ame-shared/propertyFilters";
import { visibilityProperties } from "../references/visibility.js";

describe("visibilityProperties", () => {
  const values = new Map<string, unknown>([["ref:partner/p2/choice", "left"]]);

  it("adds each resolved ref under its raw string, next to the participant's properties", () => {
    const props = visibilityProperties({ language: "en" }, values);
    expect(
      evaluateFilters(props, [
        { property: "ref:partner/p2/choice", operator: "eq", value: "left" },
        { property: "language", operator: "eq", value: "en" },
      ]),
    ).toBe(true);
  });

  it("an unresolved ref never matches, not even neq", () => {
    expect(
      evaluateFilters(visibilityProperties({}, new Map()), [
        { property: "ref:partner/p2/choice", operator: "neq", value: "left" },
      ]),
    ).toBe(false);
  });

  it("does not modify the participant's properties", () => {
    const properties = { language: "en" };
    visibilityProperties(properties, values);
    expect(properties).toEqual({ language: "en" });
  });
});
