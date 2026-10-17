import { describe, it, expect } from "vitest";
import type { DeviceConfig } from "ame-shared";
import { shouldPromptForPairing, buildControllerPairingUrl } from "../pairingPrompt";

const Controller: DeviceConfig = { mode: "controller" };
const Camera: DeviceConfig = { mode: "camera" };

describe("shouldPromptForPairing", () => {
  it("prompts for a controller routine with nothing paired yet", () => {
    expect(shouldPromptForPairing(Controller, false)).toBe(true);
  });

  it("stops prompting once the controller has connected", () => {
    expect(shouldPromptForPairing(Controller, true)).toBe(false);
  });

  it("never prompts for a routine with no device config", () => {
    expect(shouldPromptForPairing(null, false)).toBe(false);
    expect(shouldPromptForPairing(undefined, false)).toBe(false);
  });

  it("never prompts for camera mode, even unconnected", () => {
    // Multi-capture devices have their own pairing UI (ElMultiCapture's QR
    // code); this prompt is for the controller pairing only.
    expect(shouldPromptForPairing(Camera, false)).toBe(false);
  });
});

describe("buildControllerPairingUrl", () => {
  it("builds a device URL scoped to the experiment and participant, mode=controller", () => {
    expect(buildControllerPairingUrl("https://ame.example", "exp-1", "p-1")).toBe(
      "https://ame.example/device/exp-1/p-1?mode=controller",
    );
  });
});
