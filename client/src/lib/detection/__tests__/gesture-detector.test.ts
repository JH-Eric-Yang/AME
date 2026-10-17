import { describe, it, expect } from "vitest";
import { detectGesture } from "../gesture-detector";
import type { NormalizedLandmark } from "../fov-validator";
import type { HandLandmarks } from "../mediapipe-service";

function lm(x: number, y: number, visibility = 0.9): NormalizedLandmark {
  return { x, y, z: 0, visibility };
}

function allPoseLandmarks(vis = 0.9) {
  return Array.from({ length: 33 }, () => lm(0.5, 0.5, vis));
}

// Hand landmark indices: 0=wrist, 4=thumb_tip, 8=index_tip, 12=middle_tip, 16=ring_tip, 20=pinky_tip
// MCPs: 5=index_mcp, 9=middle_mcp, 13=ring_mcp, 17=pinky_mcp
// PIPs: 6=index_pip, 10=middle_pip, 14=ring_pip, 18=pinky_pip
function handLandmarks(overrides: Record<number, NormalizedLandmark> = {}): NormalizedLandmark[] {
  const base = Array.from({ length: 21 }, () => lm(0.5, 0.5));
  for (const [idx, val] of Object.entries(overrides)) {
    base[Number(idx)] = val;
  }
  return base;
}

function makeHand(
  handedness: "Left" | "Right",
  overrides: Record<number, NormalizedLandmark> = {},
): HandLandmarks {
  return { landmarks: handLandmarks(overrides), handedness };
}

describe("detectGesture", () => {
  describe("face-present", () => {
    it("returns true when face landmarks are visible", () => {
      expect(detectGesture("face-present", allPoseLandmarks(), [])).toBe(true);
    });

    it("returns false when face landmarks are not visible", () => {
      expect(detectGesture("face-present", allPoseLandmarks(0.1), [])).toBe(false);
    });
  });

  describe("face-absent", () => {
    it("returns true when face landmarks are not detected", () => {
      expect(detectGesture("face-absent", allPoseLandmarks(0.1), [])).toBe(true);
    });

    it("returns false when face is visible", () => {
      expect(detectGesture("face-absent", allPoseLandmarks(), [])).toBe(false);
    });

    it("returns true when pose landmarks array is empty", () => {
      expect(detectGesture("face-absent", [], [])).toBe(true);
    });
  });

  describe("hands-raised", () => {
    it("returns true when both wrists are above shoulders", () => {
      const pose = allPoseLandmarks();
      pose[11] = lm(0.3, 0.5); // left shoulder
      pose[12] = lm(0.7, 0.5); // right shoulder
      pose[15] = lm(0.3, 0.3); // left wrist above shoulder
      pose[16] = lm(0.7, 0.3); // right wrist above shoulder
      expect(detectGesture("hands-raised", pose, [])).toBe(true);
    });

    it("returns false when wrists are below shoulders", () => {
      const pose = allPoseLandmarks();
      pose[11] = lm(0.3, 0.4);
      pose[12] = lm(0.7, 0.4);
      pose[15] = lm(0.3, 0.6); // below
      pose[16] = lm(0.7, 0.6); // below
      expect(detectGesture("hands-raised", pose, [])).toBe(false);
    });
  });

  describe("hand-raised-left", () => {
    it("returns true when left wrist is above left shoulder", () => {
      const pose = allPoseLandmarks();
      pose[11] = lm(0.3, 0.5);
      pose[15] = lm(0.3, 0.3);
      expect(detectGesture("hand-raised-left", pose, [])).toBe(true);
    });

    it("returns false when left wrist is below left shoulder", () => {
      const pose = allPoseLandmarks();
      pose[11] = lm(0.3, 0.4);
      pose[15] = lm(0.3, 0.6);
      expect(detectGesture("hand-raised-left", pose, [])).toBe(false);
    });
  });

  describe("hand-raised-right", () => {
    it("returns true when right wrist is above right shoulder", () => {
      const pose = allPoseLandmarks();
      pose[12] = lm(0.7, 0.5);
      pose[16] = lm(0.7, 0.3);
      expect(detectGesture("hand-raised-right", pose, [])).toBe(true);
    });
  });

  describe("index-finger-up", () => {
    it("returns true when index is extended and other fingers curled", () => {
      // Index tip (8) well above index MCP (5), others curled
      const hand = makeHand("Right", {
        0: lm(0.5, 0.7),   // wrist
        5: lm(0.5, 0.5),   // index MCP
        6: lm(0.5, 0.4),   // index PIP
        8: lm(0.5, 0.2),   // index tip — extended up
        9: lm(0.5, 0.5),   // middle MCP
        12: lm(0.5, 0.6),  // middle tip — curled (below MCP)
        13: lm(0.5, 0.5),  // ring MCP
        16: lm(0.5, 0.6),  // ring tip — curled
        17: lm(0.5, 0.5),  // pinky MCP
        20: lm(0.5, 0.6),  // pinky tip — curled
      });
      expect(detectGesture("index-finger-up", [], [hand])).toBe(true);
    });

    it("returns false when all fingers are extended", () => {
      const hand = makeHand("Right", {
        0: lm(0.5, 0.7),
        5: lm(0.5, 0.5),
        8: lm(0.5, 0.2),   // index extended
        9: lm(0.5, 0.5),
        12: lm(0.5, 0.2),  // middle also extended
        13: lm(0.5, 0.5),
        16: lm(0.5, 0.2),  // ring also extended
        17: lm(0.5, 0.5),
        20: lm(0.5, 0.2),  // pinky also extended
      });
      expect(detectGesture("index-finger-up", [], [hand])).toBe(false);
    });

    it("returns false when no hands detected", () => {
      expect(detectGesture("index-finger-up", [], [])).toBe(false);
    });
  });

  describe("thumbs-up", () => {
    it("returns true when thumb is extended up and fingers curled", () => {
      const hand = makeHand("Right", {
        0: lm(0.5, 0.7),   // wrist
        2: lm(0.4, 0.5),   // thumb MCP (IP joint)
        4: lm(0.4, 0.3),   // thumb tip — extended up
        5: lm(0.5, 0.5),   // index MCP
        8: lm(0.5, 0.6),   // index tip — curled
        9: lm(0.5, 0.5),
        12: lm(0.5, 0.6),  // middle — curled
        13: lm(0.5, 0.5),
        16: lm(0.5, 0.6),  // ring — curled
        17: lm(0.5, 0.5),
        20: lm(0.5, 0.6),  // pinky — curled
      });
      expect(detectGesture("thumbs-up", [], [hand])).toBe(true);
    });

    it("returns false when thumb is not extended", () => {
      const hand = makeHand("Right", {
        0: lm(0.5, 0.7),
        2: lm(0.4, 0.5),
        4: lm(0.4, 0.6),   // thumb tip below MCP — not extended
        5: lm(0.5, 0.5),
        8: lm(0.5, 0.6),
      });
      expect(detectGesture("thumbs-up", [], [hand])).toBe(false);
    });
  });

  describe("open-palm", () => {
    it("returns true when all fingers are extended", () => {
      const hand = makeHand("Right", {
        0: lm(0.5, 0.8),   // wrist
        2: lm(0.3, 0.5),   // thumb IP
        4: lm(0.2, 0.3),   // thumb tip — extended
        5: lm(0.4, 0.5),   // index MCP
        8: lm(0.4, 0.2),   // index tip — extended
        9: lm(0.5, 0.5),   // middle MCP
        12: lm(0.5, 0.2),  // middle tip — extended
        13: lm(0.6, 0.5),  // ring MCP
        16: lm(0.6, 0.2),  // ring tip — extended
        17: lm(0.7, 0.5),  // pinky MCP
        20: lm(0.7, 0.2),  // pinky tip — extended
      });
      expect(detectGesture("open-palm", [], [hand])).toBe(true);
    });

    it("returns false when fingers are curled", () => {
      const hand = makeHand("Right", {
        5: lm(0.5, 0.5),
        8: lm(0.5, 0.6),   // index curled
        9: lm(0.5, 0.5),
        12: lm(0.5, 0.6),  // middle curled
      });
      expect(detectGesture("open-palm", [], [hand])).toBe(false);
    });
  });

  describe("peace-sign", () => {
    it("returns true when index and middle extended, others curled", () => {
      const hand = makeHand("Right", {
        0: lm(0.5, 0.7),
        5: lm(0.4, 0.5),
        8: lm(0.4, 0.2),   // index — extended
        9: lm(0.5, 0.5),
        12: lm(0.5, 0.2),  // middle — extended
        13: lm(0.6, 0.5),
        16: lm(0.6, 0.6),  // ring — curled
        17: lm(0.7, 0.5),
        20: lm(0.7, 0.6),  // pinky — curled
      });
      expect(detectGesture("peace-sign", [], [hand])).toBe(true);
    });
  });

  describe("fist", () => {
    it("returns true when all fingers are curled", () => {
      const hand = makeHand("Right", {
        0: lm(0.5, 0.7),
        2: lm(0.4, 0.5),
        4: lm(0.45, 0.55), // thumb tucked
        5: lm(0.5, 0.5),
        8: lm(0.5, 0.6),   // all tips below MCPs
        9: lm(0.5, 0.5),
        12: lm(0.5, 0.6),
        13: lm(0.6, 0.5),
        16: lm(0.6, 0.6),
        17: lm(0.7, 0.5),
        20: lm(0.7, 0.6),
      });
      expect(detectGesture("fist", [], [hand])).toBe(true);
    });

    it("returns false when fingers are extended", () => {
      const hand = makeHand("Right", {
        5: lm(0.5, 0.5),
        8: lm(0.5, 0.2),   // index extended
        9: lm(0.5, 0.5),
        12: lm(0.5, 0.2),  // middle extended
      });
      expect(detectGesture("fist", [], [hand])).toBe(false);
    });

    it("returns false when no hands detected", () => {
      expect(detectGesture("fist", [], [])).toBe(false);
    });
  });
});
