// client/src/lib/admin/__tests__/paramValues.test.ts
import { describe, it, expect } from "vitest";
import type { ParamInfo } from "ame-shared/parameterHelp";
import { cellToValue, valueToCell, parsePastedValues, mediaKind } from "../paramValues";

const info = (type: string, extra: Partial<ParamInfo> = {}): ParamInfo => ({ description: "", type, ...extra });
const OptionList = "{ value: string; label: string }[]";

describe("cellToValue", () => {
  it("reads numbers and refuses text in a number param", () => {
    expect(cellToValue(info("number"), " 1500 ")).toEqual({ value: 1500, error: null });
    expect(cellToValue(info("number | null"), "2.5")).toEqual({ value: 2.5, error: null });
    expect(cellToValue(info("number"), "abc")).toEqual({ value: null, error: '"abc" is not a number' });
  });

  it("reads a number-or-string param as a number only when it is one", () => {
    expect(cellToValue(info("number | string"), "40")).toEqual({ value: 40, error: null });
    expect(cellToValue(info("number | string"), "ref:self/p0/x")).toEqual({ value: "ref:self/p0/x", error: null });
  });

  it("reads booleans in any case and refuses other text", () => {
    expect(cellToValue(info("boolean"), "TRUE")).toEqual({ value: true, error: null });
    expect(cellToValue(info("boolean"), "false")).toEqual({ value: false, error: null });
    expect(cellToValue(info("boolean"), "yes")).toEqual({ value: null, error: '"yes" is not true or false' });
  });

  it("splits a string list on | and drops empty items", () => {
    expect(cellToValue(info("string[]"), "f | j||")).toEqual({ value: ["f", "j"], error: null });
  });

  it("reads a string list written as JSON", () => {
    expect(cellToValue(info("string[]"), '["a|b","c"]')).toEqual({ value: ["a|b", "c"], error: null });
  });

  it("reads an option list with and without labels", () => {
    expect(cellToValue(info(OptionList), "yes=Yes, I agree|no")).toEqual({
      value: [{ value: "yes", label: "Yes, I agree" }, { value: "no", label: "no" }],
      error: null,
    });
  });

  it("refuses a value that is not one of the options", () => {
    const align = info("string", { options: ["left", "center"] });
    expect(cellToValue(align, "center")).toEqual({ value: "center", error: null });
    expect(cellToValue(align, " center ")).toEqual({ value: "center", error: null });
    expect(cellToValue(align, "middle")).toEqual({ value: null, error: '"middle" is not one of: left, center' });
  });

  it("parses JSON for an object param, and refuses invalid JSON", () => {
    expect(cellToValue(info("object"), '{"a":1}')).toEqual({ value: { a: 1 }, error: null });
    expect(cellToValue(info("object"), "{bad")).toEqual({ value: null, error: '"{bad" is not valid JSON' });
  });

  it("keeps a text stimulus that starts with [ as text", () => {
    expect(cellToValue(info("string"), "[Pause] Look at the screen")).toEqual({ value: "[Pause] Look at the screen", error: null });
  });

  it("keeps a text value exactly, with its spaces", () => {
    expect(cellToValue(info("string"), "  two spaces")).toEqual({ value: "  two spaces", error: null });
  });
});

describe("valueToCell", () => {
  it("writes empty for a missing value", () => {
    expect(valueToCell(info("string"), undefined)).toBe("");
    expect(valueToCell(info("number | null"), null)).toBe("");
  });

  it("writes scalars as text", () => {
    expect(valueToCell(info("number"), 3)).toBe("3");
    expect(valueToCell(info("boolean"), false)).toBe("false");
    expect(valueToCell(info("string"), "Hi")).toBe("Hi");
  });

  it("writes lists with |, and as JSON when an item holds a |", () => {
    expect(valueToCell(info("string[]"), ["f", "j"])).toBe("f|j");
    expect(valueToCell(info("string[]"), ["a|b"])).toBe('["a|b"]');
  });

  it("writes option lists as value=label, or value alone when they agree", () => {
    expect(valueToCell(info(OptionList), [{ value: "y", label: "Yes" }, { value: "n", label: "n" }])).toBe("y=Yes|n");
  });

  it("round-trips every kind through cellToValue", () => {
    const cases: Array<[ParamInfo, unknown]> = [
      [info("number"), 12],
      [info("boolean"), true],
      [info("string[]"), ["a|b", "c"]],
      [info(OptionList), [{ value: "a=b", label: "A" }]],
      [info("object"), { x: [1, 2] }],
    ];
    for (const [i, value] of cases) expect(cellToValue(i, valueToCell(i, value)).value).toEqual(value);
  });
});

describe("parsePastedValues", () => {
  it("makes one value per non-blank line", () => {
    expect(parsePastedValues(info("string"), "Alpha\n\nBeta\r\nGamma\n")).toEqual({ values: ["Alpha", "Beta", "Gamma"], error: null });
  });

  it("names the line of the first bad value", () => {
    expect(parsePastedValues(info("number"), "1\n\nx")).toEqual({ values: [], error: 'Line 3: "x" is not a number' });
  });
});

describe("mediaKind", () => {
  it("is the element type for an image, video or audio src", () => {
    expect(mediaKind("image", "src")).toBe("image");
    expect(mediaKind("audio", "src")).toBe("audio");
  });

  it("is null for other params and types", () => {
    expect(mediaKind("image", "alt")).toBeNull();
    expect(mediaKind("text", "src")).toBeNull();
  });
});
