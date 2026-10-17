import { describe, it, expect } from "vitest";
import { optionGroupDefaultPatch } from "../defaultValueField";

describe("optionGroupDefaultPatch", () => {
  it("splits comma-separated values for checkboxes", () => {
    expect(optionGroupDefaultPatch("a, b ,,c", "checkbox")).toEqual(["a", "b", "c"]);
  });

  it("keeps one value for radio and toggle, and the radio default", () => {
    expect(optionGroupDefaultPatch("a, b", "radio")).toBe("a, b");
    expect(optionGroupDefaultPatch("a", "toggle")).toBe("a");
    expect(optionGroupDefaultPatch("a", undefined)).toBe("a");
  });

  it("keeps a reference whole, even for checkboxes", () => {
    expect(optionGroupDefaultPatch("ref:self/p0/choice", "checkbox")).toBe("ref:self/p0/choice");
  });

  it("clears on empty", () => {
    expect(optionGroupDefaultPatch(undefined, "checkbox")).toBeUndefined();
    expect(optionGroupDefaultPatch(" , ", "checkbox")).toBeUndefined();
  });
});
