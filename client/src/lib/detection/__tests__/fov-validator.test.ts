import { describe, it, expect } from "vitest";
import { validateFov, type ValidationResult } from "../fov-validator";
import type { RoutinePosCheckConfig } from "ame-shared";

// Helper: create a landmark with given x, y, visibility
function lm(x: number, y: number, visibility: number) {
  return { x, y, z: 0, visibility };
}

// Helper: create 33 landmarks all visible and in-frame
function allVisible() {
  return Array.from({ length: 33 }, () => lm(0.5, 0.5, 0.9));
}

// Helper: create 33 landmarks all invisible
function allHidden() {
  return Array.from({ length: 33 }, () => lm(0.5, 0.5, 0.0));
}

describe("validateFov", () => {
  describe("preset mode", () => {
    const faceConfig: RoutinePosCheckConfig = {
      mode: "preset",
      preset: "face",
      confidenceThreshold: 0.6,
    };

    it("passes when all face landmarks are visible and in-frame", () => {
      const result = validateFov(allVisible(), faceConfig);
      expect(result.passed).toBe(true);
    });

    it("fails when face landmarks have low visibility", () => {
      const landmarks = allVisible();
      landmarks[0] = lm(0.5, 0.5, 0.1); // nose below threshold
      const result = validateFov(landmarks, faceConfig);
      expect(result.passed).toBe(false);
    });

    it("fails when face landmark is out of frame (x > 1)", () => {
      const landmarks = allVisible();
      landmarks[0] = lm(1.2, 0.5, 0.9); // nose off-screen right
      const result = validateFov(landmarks, faceConfig);
      expect(result.passed).toBe(false);
    });

    it("passes upper-body preset when landmarks 0-16 are visible", () => {
      const config: RoutinePosCheckConfig = {
        mode: "preset",
        preset: "upper-body",
        confidenceThreshold: 0.6,
      };
      const result = validateFov(allVisible(), config);
      expect(result.passed).toBe(true);
    });

    it("fails upper-body preset when a shoulder is missing", () => {
      const config: RoutinePosCheckConfig = {
        mode: "preset",
        preset: "upper-body",
        confidenceThreshold: 0.6,
      };
      const landmarks = allVisible();
      landmarks[11] = lm(0.5, 0.5, 0.1); // left shoulder low confidence
      const result = validateFov(landmarks, config);
      expect(result.passed).toBe(false);
    });

    it("passes full-body preset when all 33 landmarks are visible", () => {
      const config: RoutinePosCheckConfig = {
        mode: "preset",
        preset: "full-body",
        confidenceThreshold: 0.6,
      };
      const result = validateFov(allVisible(), config);
      expect(result.passed).toBe(true);
    });

    it("uses default threshold of 0.6 when not specified", () => {
      const config: RoutinePosCheckConfig = { mode: "preset", preset: "face" };
      const landmarks = allVisible();
      landmarks[0] = lm(0.5, 0.5, 0.55); // below default 0.6
      const result = validateFov(landmarks, config);
      expect(result.passed).toBe(false);
    });
  });

  describe("custom mode", () => {
    it("passes when all specified landmarks are visible", () => {
      const config: RoutinePosCheckConfig = {
        mode: "custom",
        targetLandmarks: [0, 11, 12], // nose, left shoulder, right shoulder
        confidenceThreshold: 0.6,
      };
      const result = validateFov(allVisible(), config);
      expect(result.passed).toBe(true);
    });

    it("fails when a specified landmark is missing", () => {
      const config: RoutinePosCheckConfig = {
        mode: "custom",
        targetLandmarks: [0, 11, 12],
        confidenceThreshold: 0.6,
      };
      const landmarks = allVisible();
      landmarks[12] = lm(0.5, 0.5, 0.1); // right shoulder low confidence
      const result = validateFov(landmarks, config);
      expect(result.passed).toBe(false);
    });

    it("defaults to empty landmark set if targetLandmarks not specified", () => {
      const config: RoutinePosCheckConfig = { mode: "custom", confidenceThreshold: 0.6 };
      const result = validateFov(allVisible(), config);
      expect(result.passed).toBe(true); // no requirements = pass
    });
  });

  describe("legacy mode", () => {
    const legacyConfig: RoutinePosCheckConfig = {
      mode: "legacy",
      confidenceThreshold: 0.6,
    };

    it("passes when face is in upper 2/5 and wrists are in upper 4/5", () => {
      const landmarks = allHidden();
      // Face landmarks (0-10) in upper portion (y < 0.4)
      for (let i = 0; i <= 10; i++) {
        landmarks[i] = lm(0.5, 0.3, 0.9);
      }
      // Left wrist (15) and right wrist (16) in upper 4/5 (y < 0.8)
      landmarks[15] = lm(0.3, 0.6, 0.9);
      landmarks[16] = lm(0.7, 0.6, 0.9);
      const result = validateFov(landmarks, legacyConfig);
      expect(result.passed).toBe(true);
    });

    it("fails when face is too low (y >= 0.4)", () => {
      const landmarks = allHidden();
      for (let i = 0; i <= 10; i++) {
        landmarks[i] = lm(0.5, 0.5, 0.9); // face at y=0.5, below 0.4 threshold
      }
      landmarks[15] = lm(0.3, 0.6, 0.9);
      landmarks[16] = lm(0.7, 0.6, 0.9);
      const result = validateFov(landmarks, legacyConfig);
      expect(result.passed).toBe(false);
      expect(result.guidance).toContain("face");
    });

    it("fails when wrists are too low (y >= 0.8)", () => {
      const landmarks = allHidden();
      for (let i = 0; i <= 10; i++) {
        landmarks[i] = lm(0.5, 0.3, 0.9);
      }
      landmarks[15] = lm(0.3, 0.85, 0.9); // left wrist too low
      landmarks[16] = lm(0.7, 0.6, 0.9);
      const result = validateFov(landmarks, legacyConfig);
      expect(result.passed).toBe(false);
      expect(result.guidance).toContain("hands");
    });

    it("fails when wrists are not detected", () => {
      const landmarks = allHidden();
      for (let i = 0; i <= 10; i++) {
        landmarks[i] = lm(0.5, 0.3, 0.9);
      }
      // wrists not set — visibility 0.0
      const result = validateFov(landmarks, legacyConfig);
      expect(result.passed).toBe(false);
    });
  });

  describe("distance mode", () => {
    const distConfig: RoutinePosCheckConfig = {
      mode: "distance",
      faceRatioMin: 0.15,
      faceRatioMax: 0.25,
      confidenceThreshold: 0.6,
    };

    it("passes when face ratio is within range", () => {
      const landmarks = allHidden();
      // Face top ~ y=0.25, face bottom ~ y=0.45 → ratio = 0.20
      landmarks[10] = lm(0.5, 0.25, 0.9);
      landmarks[2] = lm(0.5, 0.45, 0.9);
      // Fill remaining face landmarks in between
      for (let i = 0; i <= 10; i++) {
        if (!landmarks[i] || landmarks[i].visibility < 0.6) {
          landmarks[i] = lm(0.5, 0.35, 0.9);
        }
      }
      const result = validateFov(landmarks, distConfig);
      expect(result.passed).toBe(true);
      expect(result.faceRatio).toBeGreaterThanOrEqual(0.15);
      expect(result.faceRatio).toBeLessThanOrEqual(0.25);
    });

    it("fails when face is too close (ratio > max)", () => {
      const landmarks = allHidden();
      // Face occupying large portion: y from 0.1 to 0.6 → ratio = 0.5
      for (let i = 0; i <= 10; i++) {
        landmarks[i] = lm(0.5, 0.1 + i * 0.05, 0.9);
      }
      const result = validateFov(landmarks, distConfig);
      expect(result.passed).toBe(false);
      expect(result.guidance).toContain("further");
    });

    it("fails when face is too far (ratio < min)", () => {
      const landmarks = allHidden();
      // Face occupying tiny portion: y from 0.40 to 0.45 → ratio = 0.05
      for (let i = 0; i <= 10; i++) {
        landmarks[i] = lm(0.5, 0.40 + i * 0.004, 0.9);
      }
      const result = validateFov(landmarks, distConfig);
      expect(result.passed).toBe(false);
      expect(result.guidance).toContain("closer");
    });

    it("fails when face landmarks are not detected", () => {
      const result = validateFov(allHidden(), distConfig);
      expect(result.passed).toBe(false);
    });
  });
});
