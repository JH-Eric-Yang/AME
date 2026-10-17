import { describe, it, expect } from "vitest";
import { multiCaptureView } from "../multiCaptureView";

describe("multiCaptureView", () => {
  describe("a recording step", () => {
    it("shows the QR code and no start button while a device is missing", () => {
      expect(multiCaptureView({}, false)).toEqual({ showQrCode: true, showStart: false, startByItself: false, paired: false, showStop: true });
    });

    it("hides the QR code and shows the start button when every device is connected", () => {
      expect(multiCaptureView({}, true)).toEqual({ showQrCode: false, showStart: true, startByItself: false, paired: false, showStop: true });
    });

    it("starts by itself with autoStart once every device is connected", () => {
      expect(multiCaptureView({ autoStart: true }, true).startByItself).toBe(true);
    });
  });

  describe("a pairing step (pairOnly)", () => {
    it("never offers to record, even with autoStart", () => {
      const view = multiCaptureView({ pairOnly: true, autoStart: true }, true);
      expect(view.showStart).toBe(false);
      expect(view.startByItself).toBe(false);
    });

    it("tells the participant that the devices are paired", () => {
      expect(multiCaptureView({ pairOnly: true }, true)).toEqual({ showQrCode: false, showStart: false, startByItself: false, paired: true, showStop: true });
      expect(multiCaptureView({ pairOnly: true }, false).paired).toBe(false);
    });
  });

  describe("a recording step that is not for pairing (showPairing: false)", () => {
    it("never shows the QR code, even while a device is missing", () => {
      expect(multiCaptureView({ showPairing: false }, false).showQrCode).toBe(false);
    });
  });

  describe("the stop button", () => {
    it("shows by default", () => {
      expect(multiCaptureView({}, true).showStop).toBe(true);
    });

    it("hides with showStopButton: false", () => {
      expect(multiCaptureView({ showStopButton: false }, true).showStop).toBe(false);
    });

    it("still hides with showPreview: false when showStopButton is not set, as before", () => {
      expect(multiCaptureView({ showPreview: false }, true).showStop).toBe(false);
      expect(multiCaptureView({ showPreview: false, showStopButton: true }, true).showStop).toBe(true);
    });
  });
});
