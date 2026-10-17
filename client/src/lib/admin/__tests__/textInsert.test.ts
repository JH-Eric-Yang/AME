import { describe, it, expect } from "vitest";
import { insertAt } from "../textInsert";

describe("insertAt", () => {
  it("splices at the caret and reports the new caret position", () => {
    expect(insertAt("Hello world", 6, 6, "{{ref:self/p0/name}} ")).toEqual({
      text: "Hello {{ref:self/p0/name}} world", caret: 27,
    });
  });

  it("replaces a selection", () => {
    expect(insertAt("Hello world", 6, 11, "there")).toEqual({ text: "Hello there", caret: 11 });
  });

  it("appends when the caret is past the end or unknown", () => {
    expect(insertAt("abc", 99, 99, "X")).toEqual({ text: "abcX", caret: 4 });
    expect(insertAt("abc", -1, -1, "X")).toEqual({ text: "abcX", caret: 4 });
  });
});
