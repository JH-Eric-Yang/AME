import { describe, it, expect } from "vitest";
import { stimulusParams, getParamInfo } from "ame-shared/parameterHelp";
import { FamilyOfElement } from "ame-shared/elementFamilies";
import type { ElementType } from "ame-shared";

/** Spec §4.1: the params a starter CSV gives a column. */
const Expected: Partial<Record<ElementType, string[]>> = {
  text: ["content"],
  image: ["src", "alt"],
  video: ["src"],
  audio: ["src"],
  button: ["label"],
  "input-textfield": ["placeholder"],
  "input-select": ["options"],
  "input-option-group": ["options"],
  "input-slider": ["min", "max", "leftLabel", "rightLabel"],
  keyboard: ["keys"],
  timer: ["duration"],
};

describe("stimulusParams", () => {
  it("marks exactly the spec's stimulus params, in declaration order", () => {
    for (const type of Object.keys(FamilyOfElement) as ElementType[]) {
      expect(stimulusParams(type), type).toEqual(Expected[type] ?? []);
    }
  });

  it("types an input-select option list as the option objects it holds", () => {
    expect(getParamInfo("input-select", "options")?.type).toBe("{ value: string; label: string }[]");
  });

  it("gives the timer duration and warning in seconds, with a default of 60", () => {
    // "milliseconds" also holds "seconds", so match the whole word.
    expect(getParamInfo("timer", "duration")?.description).toMatch(/\bseconds\b/);
    expect(getParamInfo("timer", "duration")?.default).toBe("60");
    expect(getParamInfo("timer", "warningTime")?.description).toMatch(/\bseconds\b/i);
  });
});
