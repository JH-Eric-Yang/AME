import type { GestureTrigger } from "ame-shared";
import type { NormalizedLandmark } from "./fov-validator";
import type { HandLandmarks } from "./mediapipe-service";

const DefaultThreshold = 0.5;

// ── Pose-based triggers ──────────────────────────────────────────────────────

const FaceLandmarkIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const MinFaceLandmarksForPresence = 5;

function isFacePresent(pose: NormalizedLandmark[], threshold = DefaultThreshold): boolean {
  let count = 0;
  for (const idx of FaceLandmarkIndices) {
    if (pose[idx] && pose[idx].visibility >= threshold) count++;
  }
  return count >= MinFaceLandmarksForPresence;
}

function isHandRaised(
  pose: NormalizedLandmark[],
  shoulderIdx: number,
  wristIdx: number,
  threshold = DefaultThreshold,
): boolean {
  const shoulder = pose[shoulderIdx];
  const wrist = pose[wristIdx];
  if (!shoulder || !wrist) return false;
  if (shoulder.visibility < threshold || wrist.visibility < threshold) return false;
  return wrist.y < shoulder.y;
}

// ── Hand-based triggers ──────────────────────────────────────────────────────

// Hand landmark indices (MediaPipe Hand Landmarker 21-point model)
// Finger tips: 4=thumb, 8=index, 12=middle, 16=ring, 20=pinky
// Finger MCPs: 2=thumb_IP, 5=index, 9=middle, 13=ring, 17=pinky
// Finger PIPs: 3=thumb_IP2, 6=index, 10=middle, 14=ring, 18=pinky

function isFingerExtended(hand: NormalizedLandmark[], tipIdx: number, mcpIdx: number): boolean {
  const tip = hand[tipIdx];
  const mcp = hand[mcpIdx];
  if (!tip || !mcp) return false;
  // Finger is extended if tip is significantly above MCP (lower y = higher on screen)
  return tip.y < mcp.y - 0.02;
}

function isFingerCurled(hand: NormalizedLandmark[], tipIdx: number, mcpIdx: number): boolean {
  const tip = hand[tipIdx];
  const mcp = hand[mcpIdx];
  if (!tip || !mcp) return false;
  return tip.y >= mcp.y;
}

function isThumbExtended(hand: NormalizedLandmark[]): boolean {
  const tip = hand[4];
  const ip = hand[2]; // thumb IP joint
  if (!tip || !ip) return false;
  return tip.y < ip.y - 0.05;
}

function isThumbCurled(hand: NormalizedLandmark[]): boolean {
  return !isThumbExtended(hand);
}

interface FingerState {
  indexExtended: boolean;
  middleExtended: boolean;
  ringExtended: boolean;
  pinkyExtended: boolean;
  thumbExtended: boolean;
}

function getFingerState(hand: NormalizedLandmark[]): FingerState {
  return {
    indexExtended: isFingerExtended(hand, 8, 5),
    middleExtended: isFingerExtended(hand, 12, 9),
    ringExtended: isFingerExtended(hand, 16, 13),
    pinkyExtended: isFingerExtended(hand, 20, 17),
    thumbExtended: isThumbExtended(hand),
  };
}

function checkIndexFingerUp(hands: HandLandmarks[]): boolean {
  return hands.some((h) => {
    const s = getFingerState(h.landmarks);
    return s.indexExtended && !s.middleExtended && !s.ringExtended && !s.pinkyExtended;
  });
}

function checkThumbsUp(hands: HandLandmarks[]): boolean {
  return hands.some((h) => {
    const s = getFingerState(h.landmarks);
    return s.thumbExtended && !s.indexExtended && !s.middleExtended && !s.ringExtended && !s.pinkyExtended;
  });
}

function checkOpenPalm(hands: HandLandmarks[]): boolean {
  return hands.some((h) => {
    const s = getFingerState(h.landmarks);
    return s.indexExtended && s.middleExtended && s.ringExtended && s.pinkyExtended;
  });
}

function checkPeaceSign(hands: HandLandmarks[]): boolean {
  return hands.some((h) => {
    const s = getFingerState(h.landmarks);
    return s.indexExtended && s.middleExtended && !s.ringExtended && !s.pinkyExtended;
  });
}

function checkFist(hands: HandLandmarks[]): boolean {
  return hands.some((h) => {
    const lms = h.landmarks;
    const indexCurled = isFingerCurled(lms, 8, 5);
    const middleCurled = isFingerCurled(lms, 12, 9);
    const ringCurled = isFingerCurled(lms, 16, 13);
    const pinkyCurled = isFingerCurled(lms, 20, 17);
    return indexCurled && middleCurled && ringCurled && pinkyCurled;
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

export function detectGesture(
  trigger: GestureTrigger,
  poseLandmarks: NormalizedLandmark[],
  hands: HandLandmarks[],
  threshold = DefaultThreshold,
): boolean {
  switch (trigger) {
    case "face-present":
      return isFacePresent(poseLandmarks, threshold);
    case "face-absent":
      return !isFacePresent(poseLandmarks, threshold);
    case "hands-raised":
      return isHandRaised(poseLandmarks, 11, 15, threshold) &&
             isHandRaised(poseLandmarks, 12, 16, threshold);
    case "hand-raised-left":
      return isHandRaised(poseLandmarks, 11, 15, threshold);
    case "hand-raised-right":
      return isHandRaised(poseLandmarks, 12, 16, threshold);
    case "index-finger-up":
      return hands.length > 0 && checkIndexFingerUp(hands);
    case "thumbs-up":
      return hands.length > 0 && checkThumbsUp(hands);
    case "open-palm":
      return hands.length > 0 && checkOpenPalm(hands);
    case "peace-sign":
      return hands.length > 0 && checkPeaceSign(hands);
    case "fist":
      return hands.length > 0 && checkFist(hands);
    default:
      return false;
  }
}
