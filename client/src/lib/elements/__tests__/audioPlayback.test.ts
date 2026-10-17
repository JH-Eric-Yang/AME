import { describe, it, expect } from "vitest";
import { isAutoplayBlock, needsPlayButton } from "../audioPlayback";

describe("needsPlayButton", () => {
  it("shows the button when autoplay is blocked and controls are off", () => {
    expect(needsPlayButton({ autoplay: true, controls: false, blocked: true })).toBe(true);
  });
  it("shows no button when the native controls are on", () => {
    expect(needsPlayButton({ autoplay: true, controls: true, blocked: true })).toBe(false);
  });
  it("shows no button when autoplay was not blocked", () => {
    expect(needsPlayButton({ autoplay: true, controls: false, blocked: false })).toBe(false);
  });
  it("shows no button when autoplay is off", () => {
    expect(needsPlayButton({ autoplay: false, controls: false, blocked: false })).toBe(false);
  });
});

describe("isAutoplayBlock", () => {
  it("is true for the browser's NotAllowedError", () => {
    expect(isAutoplayBlock(new DOMException("blocked", "NotAllowedError"))).toBe(true);
  });
  it("is false for a source that does not load", () => {
    expect(isAutoplayBlock(new DOMException("bad source", "NotSupportedError"))).toBe(false);
  });
  it("is false for something that is not an error", () => {
    expect(isAutoplayBlock("NotAllowedError")).toBe(false);
  });
});
