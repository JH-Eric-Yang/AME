import { describe, it, expect } from "vitest";
import type { ElementConfig } from "ame-shared";
import {
  DefaultSliderValue,
  numberDefault,
  optionGroupDefault,
  recordsDefault,
  selectDefault,
  sliderDefault,
  textDefault,
} from "../inputDefaults";

const options = [{ value: "a" }, { value: "b" }, { value: "c" }];

describe("textDefault", () => {
  it("keeps text, prints numbers and booleans, and empties nothing", () => {
    expect(textDefault("Ada")).toBe("Ada");
    expect(textDefault(7)).toBe("7");
    expect(textDefault(false)).toBe("false");
    expect(textDefault(undefined)).toBe("");
    expect(textDefault(null)).toBe("");
  });

  it("writes an object or list as JSON", () => {
    expect(textDefault({ q1: "yes" })).toBe('{"q1":"yes"}');
    expect(textDefault(["a", "b"])).toBe('["a","b"]');
  });
});

describe("selectDefault", () => {
  it("selects a matching option and ignores anything else", () => {
    expect(selectDefault("b", options)).toBe("b");
    expect(selectDefault("z", options)).toBe("");
    expect(selectDefault(undefined, options)).toBe("");
  });

  it("takes the first entry of a list", () => {
    expect(selectDefault(["c", "a"], options)).toBe("c");
  });
});

describe("optionGroupDefault", () => {
  it("single choice takes the first known value", () => {
    expect(optionGroupDefault("a", false, options)).toBe("a");
    expect(optionGroupDefault(["z", "b"], false, options)).toBe("b");
    expect(optionGroupDefault("z", false, options)).toBe("");
  });

  it("multiple choice keeps every known value in the order given", () => {
    expect(optionGroupDefault(["c", "z", "a"], true, options)).toEqual(["c", "a"]);
    expect(optionGroupDefault("b", true, options)).toEqual(["b"]);
    expect(optionGroupDefault(undefined, true, options)).toEqual([]);
  });
});

describe("numberDefault and sliderDefault", () => {
  it("reads a number or numeric text and nothing else", () => {
    expect(numberDefault(7)).toBe(7);
    expect(numberDefault(" 12.5 ")).toBe(12.5);
    expect(numberDefault("")).toBeNull();
    expect(numberDefault("abc")).toBeNull();
    expect(numberDefault(undefined)).toBeNull();
  });

  it("clamps into range and falls back when there is no number", () => {
    expect(sliderDefault(120, 0, 100)).toBe(100);
    expect(sliderDefault("-5", 0, 100)).toBe(0);
    expect(sliderDefault("", 0, 100)).toBe(DefaultSliderValue);
  });
});

describe("recordsDefault", () => {
  const plain = { name: "x", type: "input-textfield", params: {} } as ElementConfig;
  const withDataEvent = { ...plain, events: [{ trigger: "change", type: "data" }] } as ElementConfig;

  it("records a non-empty default under the element name", () => {
    expect(recordsDefault(plain, "Ada")).toBe(true);
    expect(recordsDefault(plain, ["a"])).toBe(true);
    expect(recordsDefault(plain, 0)).toBe(true);
  });

  it("records nothing for an empty default", () => {
    expect(recordsDefault(plain, "")).toBe(false);
    expect(recordsDefault(plain, [])).toBe(false);
    expect(recordsDefault(plain, null)).toBe(false);
  });

  it("leaves recording to a declared data event", () => {
    expect(recordsDefault(withDataEvent, "Ada")).toBe(false);
  });
});
