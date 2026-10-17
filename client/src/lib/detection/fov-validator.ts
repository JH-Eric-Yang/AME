import type { FovPreset, RoutinePosCheckConfig } from "ame-shared";

export interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface LandmarkStatus {
  index: number;
  detected: boolean;
  inBounds: boolean;
}

export interface ValidationResult {
  passed: boolean;
  landmarks: LandmarkStatus[];
  faceRatio?: number;
  guidance?: string;
}

const DefaultConfidenceThreshold = 0.6;

const PresetLandmarks: Record<FovPreset, number[]> = {
  face: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  "upper-body": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  "full-body": Array.from({ length: 33 }, (_, i) => i),
};

function isInBounds(x: number, y: number): boolean {
  return x > 0 && x < 1 && y > 0 && y < 1;
}

function validateLandmarkSet(
  landmarks: NormalizedLandmark[],
  required: number[],
  threshold: number,
): { passed: boolean; statuses: LandmarkStatus[]; guidance?: string } {
  const statuses: LandmarkStatus[] = [];
  let allPassed = true;
  let missingCount = 0;

  for (const idx of required) {
    const lm = landmarks[idx];
    const detected = lm != null && lm.visibility >= threshold;
    const inBounds = lm != null && isInBounds(lm.x, lm.y);
    const ok = detected && inBounds;
    if (!ok) {
      allPassed = false;
      missingCount++;
    }
    statuses.push({ index: idx, detected, inBounds });
  }

  const guidance = allPassed
    ? undefined
    : missingCount > required.length / 2
      ? "Move so your body is fully visible"
      : "Adjust your position slightly";

  return { passed: allPassed, statuses, guidance };
}

const FaceBoundaryY = 0.4; // Face must be in upper 2/5 of frame
const WristBoundaryY = 0.8; // Wrists must be in upper 4/5 of frame
const FaceLandmarkIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const WristLandmarkIndices = [15, 16];

function validatePreset(
  landmarks: NormalizedLandmark[],
  config: RoutinePosCheckConfig,
): ValidationResult {
  const preset = config.preset ?? "face";
  const required = PresetLandmarks[preset];
  const threshold = config.confidenceThreshold ?? DefaultConfidenceThreshold;
  const { passed, statuses, guidance } = validateLandmarkSet(landmarks, required, threshold);
  return { passed, landmarks: statuses, guidance };
}

function validateCustom(
  landmarks: NormalizedLandmark[],
  config: RoutinePosCheckConfig,
): ValidationResult {
  const required = config.targetLandmarks ?? [];
  const threshold = config.confidenceThreshold ?? DefaultConfidenceThreshold;
  const { passed, statuses, guidance } = validateLandmarkSet(landmarks, required, threshold);
  return { passed, landmarks: statuses, guidance };
}

function validateLegacy(
  landmarks: NormalizedLandmark[],
  config: RoutinePosCheckConfig,
): ValidationResult {
  const threshold = config.confidenceThreshold ?? DefaultConfidenceThreshold;
  const statuses: LandmarkStatus[] = [];

  // Check face landmarks are detected and in upper 2/5
  let faceOk = true;
  for (const idx of FaceLandmarkIndices) {
    const lm = landmarks[idx];
    const detected = lm != null && lm.visibility >= threshold;
    const inBounds = lm != null && isInBounds(lm.x, lm.y) && lm.y < FaceBoundaryY;
    if (!detected || !inBounds) faceOk = false;
    statuses.push({ index: idx, detected, inBounds });
  }

  // Check wrist landmarks are detected and in upper 4/5
  let wristsOk = true;
  for (const idx of WristLandmarkIndices) {
    const lm = landmarks[idx];
    const detected = lm != null && lm.visibility >= threshold;
    const inBounds = lm != null && isInBounds(lm.x, lm.y) && lm.y < WristBoundaryY;
    if (!detected || !inBounds) wristsOk = false;
    statuses.push({ index: idx, detected, inBounds });
  }

  let guidance: string | undefined;
  if (!faceOk && !wristsOk) guidance = "Position your face in frame and raise your hands";
  else if (!faceOk) guidance = "Move your face higher in the frame";
  else if (!wristsOk) guidance = "Raise your hands so they are visible";

  return { passed: faceOk && wristsOk, landmarks: statuses, guidance };
}

function computeFaceRatio(
  landmarks: NormalizedLandmark[],
  threshold: number,
): number | null {
  let minY = Infinity;
  let maxY = -Infinity;
  let detectedCount = 0;

  for (const idx of FaceLandmarkIndices) {
    const lm = landmarks[idx];
    if (lm != null && lm.visibility >= threshold) {
      minY = Math.min(minY, lm.y);
      maxY = Math.max(maxY, lm.y);
      detectedCount++;
    }
  }

  // Need at least 3 face landmarks to compute a meaningful ratio
  if (detectedCount < 3) return null;

  return maxY - minY;
}

function validateDistance(
  landmarks: NormalizedLandmark[],
  config: RoutinePosCheckConfig,
): ValidationResult {
  const threshold = config.confidenceThreshold ?? DefaultConfidenceThreshold;
  const faceRatio = computeFaceRatio(landmarks, threshold);

  if (faceRatio == null) {
    return {
      passed: false,
      landmarks: [],
      faceRatio: undefined,
      guidance: "Face not detected",
    };
  }

  const min = config.faceRatioMin ?? 0;
  const max = config.faceRatioMax ?? 1;

  let passed = true;
  let guidance: string | undefined;

  if (faceRatio > max) {
    passed = false;
    guidance = "Move further from the camera";
  } else if (faceRatio < min) {
    passed = false;
    guidance = "Move closer to the camera";
  }

  return { passed, landmarks: [], faceRatio, guidance };
}

export function validateFov(
  landmarks: NormalizedLandmark[],
  config: RoutinePosCheckConfig,
): ValidationResult {
  switch (config.mode) {
    case "preset":
      return validatePreset(landmarks, config);
    case "custom":
      return validateCustom(landmarks, config);
    case "legacy":
      return validateLegacy(landmarks, config);
    case "distance":
      return validateDistance(landmarks, config);
    default:
      return { passed: false, landmarks: [], guidance: "Unknown mode" };
  }
}
