import { describe, it, expect } from "vitest";
import {
  elementSurface,
  isOnSurface,
  canRenderOnHandset,
  HandsetTypes,
} from "ame-shared/surfaces";

describe("elementSurface", () => {
  it("treats an element with no surface as a desktop element", () => {
    // Every element authored before the phone existed has no surface at all.
    expect(elementSurface({})).toBe("screen");
  });

  it("reads an explicit surface", () => {
    expect(elementSurface({ surface: "device" })).toBe("device");
    expect(elementSurface({ surface: "screen" })).toBe("screen");
  });
});

describe("isOnSurface", () => {
  it("puts an unmarked element on the screen and nowhere else", () => {
    expect(isOnSurface({}, "screen")).toBe(true);
    expect(isOnSurface({}, "device")).toBe(false);
  });

  it("puts a device element on the phone and nowhere else", () => {
    expect(isOnSurface({ surface: "device" }, "device")).toBe(true);
    expect(isOnSurface({ surface: "device" }, "screen")).toBe(false);
  });
});

describe("canRenderOnHandset", () => {
  it("admits the curated handset palette", () => {
    for (const type of ["text", "image", "button", "input-option-group",
                        "input-slider", "input-textfield", "timer"] as const) {
      expect(canRenderOnHandset(type)).toBe(true);
    }
  });

  it("refuses the camera-bound types, whose camera is busy capturing", () => {
    for (const type of ["recorder", "video-chat", "body-detector",
                        "facial-expression-detector", "multi-capture"] as const) {
      expect(canRenderOnHandset(type)).toBe(false);
    }
  });

  it("refuses survey and speech-recognizer", () => {
    // survey is a desktop-sized layout; speech-recognizer acts on
    // params.action rather than the events array, so a phone press means
    // nothing to it.
    expect(canRenderOnHandset("survey")).toBe(false);
    expect(canRenderOnHandset("speech-recognizer")).toBe(false);
  });

  it("lists exactly seven handset types", () => {
    expect(HandsetTypes).toHaveLength(7);
  });
});
