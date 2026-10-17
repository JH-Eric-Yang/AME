import { describe, it, expect } from "vitest";
import type { ElementType } from "ame-shared";
import { Families, FamilyLabel, FamilyOfElement, familyOf } from "ame-shared/elementFamilies";

const AllElementTypes: ElementType[] = [
  "text", "image", "video", "audio", "video-chat",
  "button", "recorder", "multi-capture", "input-textfield", "input-select",
  "input-slider", "input-option-group", "input-file-picker", "keyboard", "survey",
  "timer", "body-detector", "volume-check", "speech-recognizer", "facial-expression-detector",
];

describe("elementFamilies", () => {
  it("maps every element type to one family", () => {
    for (const type of AllElementTypes) {
      expect(Families).toContain(FamilyOfElement[type]);
      expect(familyOf(type)).toBe(FamilyOfElement[type]);
    }
  });

  it("puts the visual elements under stimulus", () => {
    for (const type of ["text", "image", "video", "audio", "video-chat"] as const) {
      expect(familyOf(type)).toBe("stimulus");
    }
  });

  it("puts the data elements under response", () => {
    for (const type of ["button", "recorder", "input-slider", "keyboard", "survey"] as const) {
      expect(familyOf(type)).toBe("response");
    }
  });

  it("puts the monitoring elements, including timer, under monitor", () => {
    for (const type of ["timer", "body-detector", "volume-check", "speech-recognizer", "facial-expression-detector"] as const) {
      expect(familyOf(type)).toBe("monitor");
    }
  });

  it("gives each family at least one element and a label", () => {
    const counts = { stimulus: 0, response: 0, monitor: 0 };
    for (const type of AllElementTypes) counts[FamilyOfElement[type]] += 1;
    expect(counts.stimulus).toBeGreaterThan(0);
    expect(counts.response).toBeGreaterThan(0);
    expect(counts.monitor).toBeGreaterThan(0);
    expect(FamilyLabel).toEqual({ stimulus: "Stimulus", response: "Response", monitor: "Monitor" });
    expect(Families).toEqual(["stimulus", "response", "monitor"]);
  });
});
