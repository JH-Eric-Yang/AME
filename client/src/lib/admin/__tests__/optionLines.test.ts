import { describe, it, expect } from "vitest";
import { parseOptionLines, formatOptionLines, keepOptionText } from "../optionLines";

describe("keepOptionText", () => {
  it("keeps a first key that has no pipe yet", () => {
    expect(keepOptionText("r", [{ value: "r", label: "r" }])).toBe("r");
  });
  it("keeps a pipe with no label yet", () => {
    expect(keepOptionText("r|", [{ value: "r", label: "r" }])).toBe("r|");
  });
  it("keeps a new line at the end", () => {
    expect(keepOptionText("red|Red\n", [{ value: "red", label: "Red" }])).toBe("red|Red\n");
  });
  it("loads the text again for different options, such as another element's", () => {
    expect(keepOptionText("red|Red", [{ value: "a", label: "A" }])).toBe("a|A");
  });
  it("gives empty text for no options", () => {
    expect(keepOptionText("", undefined)).toBe("");
  });
});

describe("parseOptionLines", () => {
  it("splits value|label per line", () => {
    expect(parseOptionLines("a|Apple\nb|Banana")).toEqual([
      { value: "a", label: "Apple" },
      { value: "b", label: "Banana" },
    ]);
  });

  it("uses the value as the label when none is given", () => {
    expect(parseOptionLines("yes")).toEqual([{ value: "yes", label: "yes" }]);
  });

  it("trims whitespace and skips blank lines", () => {
    expect(parseOptionLines("  a | Apple \n\n  \nb|B")).toEqual([
      { value: "a", label: "Apple" },
      { value: "b", label: "B" },
    ]);
  });

  it("keeps a pipe inside the label", () => {
    expect(parseOptionLines("x|A | B")).toEqual([{ value: "x", label: "A | B" }]);
  });
});

describe("formatOptionLines", () => {
  it("round-trips", () => {
    const options = [
      { value: "a", label: "Apple" },
      { value: "b", label: "Banana" },
    ];
    expect(parseOptionLines(formatOptionLines(options))).toEqual(options);
  });

  it("is empty when there are no options", () => {
    expect(formatOptionLines(undefined)).toBe("");
    expect(formatOptionLines([])).toBe("");
  });
});
