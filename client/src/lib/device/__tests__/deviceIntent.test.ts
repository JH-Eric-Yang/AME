import { describe, it, expect } from "vitest";
import type { ElementConfig } from "ame-shared";
import { resolveDeviceIntent } from "../deviceIntent";

const send: ElementConfig = {
  name: "send", type: "button", params: {}, surface: "device",
  events: [{ trigger: "click", type: "proceed" }],
};
const elements = [send];

describe("resolveDeviceIntent", () => {
  it("finds the element a press names", () => {
    const el = resolveDeviceIntent(
      { elementName: "send", trigger: "click", value: true, progress: 3 },
      elements, 3,
    );
    expect(el).toBe(send);
  });

  it("drops a press from a routine the participant has left", () => {
    // Phones sleep and reconnect, then re-send. Applying this would record an
    // answer against the wrong trial, or proceed a second time.
    expect(resolveDeviceIntent(
      { elementName: "send", trigger: "click", value: true, progress: 2 },
      elements, 3,
    )).toBeNull();
  });

  it("drops a press naming an element this routine does not have", () => {
    expect(resolveDeviceIntent(
      { elementName: "ghost", trigger: "click", value: true, progress: 3 },
      elements, 3,
    )).toBeNull();
  });

  it("drops everything when the phone's list is empty", () => {
    expect(resolveDeviceIntent(
      { elementName: "send", trigger: "click", value: true, progress: 3 },
      [], 3,
    )).toBeNull();
  });
});
