import {
  PoseLandmarker,
  HandLandmarker,
  FaceLandmarker,
  FilesetResolver,
  type PoseLandmarkerResult,
  type HandLandmarkerResult,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type { NormalizedLandmark } from "./fov-validator";
import type { Blendshape } from "./expression-classifier";

export interface HandLandmarks {
  landmarks: NormalizedLandmark[];
  handedness: "Left" | "Right";
}

export interface DetectionResult {
  landmarks: NormalizedLandmark[];
  hands: HandLandmarks[];
  timestamp: number;
}

export interface FaceDetectionResult {
  blendshapes: Blendshape[];
  landmarks: NormalizedLandmark[];
  timestamp: number;
}

let poseInstance: PoseLandmarker | null = null;
let handInstance: HandLandmarker | null = null;
let faceInstance: FaceLandmarker | null = null;
let poseRefCount = 0;
let handRefCount = 0;
let faceRefCount = 0;

const WasmPath = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

const PoseModelPath =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const HandModelPath =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const FaceModelPath =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let visionFileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null = null;

async function getFileset() {
  if (!visionFileset) {
    visionFileset = await FilesetResolver.forVisionTasks(WasmPath);
  }
  return visionFileset;
}

export async function initialize(): Promise<void> {
  poseRefCount++;
  if (poseInstance) return;

  const vision = await getFileset();
  poseInstance = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: PoseModelPath, delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 1,
  });
}

export async function initializeHands(): Promise<void> {
  handRefCount++;
  if (handInstance) return;

  const vision = await getFileset();
  handInstance = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: HandModelPath, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 2,
  });
}

export async function initializeFace(): Promise<void> {
  faceRefCount++;
  if (faceInstance) return;

  const vision = await getFileset();
  faceInstance = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: FaceModelPath, delegate: "GPU" },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
  });
}

function mapLandmarks(raw: { x: number; y: number; z: number; visibility?: number }[]): NormalizedLandmark[] {
  return raw.map((lm) => ({
    x: lm.x,
    y: lm.y,
    z: lm.z,
    visibility: lm.visibility ?? 0,
  }));
}

export function detect(video: HTMLVideoElement): DetectionResult | null {
  const timestamp = performance.now();

  // Pose detection
  let poseLandmarks: NormalizedLandmark[] = [];
  if (poseInstance) {
    try {
      const result: PoseLandmarkerResult = poseInstance.detectForVideo(video, timestamp);
      if (result.landmarks && result.landmarks.length > 0) {
        poseLandmarks = mapLandmarks(result.landmarks[0]);
      }
    } catch {
      // pose detection failed this frame
    }
  }

  // Hand detection (use timestamp + 1 to avoid duplicate timestamp error)
  const hands: HandLandmarks[] = [];
  if (handInstance) {
    try {
      const result: HandLandmarkerResult = handInstance.detectForVideo(video, timestamp + 1);
      if (result.landmarks && result.handedness) {
        for (let i = 0; i < result.landmarks.length; i++) {
          hands.push({
            landmarks: mapLandmarks(result.landmarks[i]),
            handedness: result.handedness[i]?.[0]?.categoryName as "Left" | "Right" ?? "Right",
          });
        }
      }
    } catch {
      // hand detection failed this frame
    }
  }

  if (poseLandmarks.length === 0 && hands.length === 0) return null;

  return { landmarks: poseLandmarks, hands, timestamp };
}

// FaceLandmarker rejects a timestamp that is not strictly increasing, so keep
// the last one used in case two callers detect within the same millisecond.
let lastFaceTimestamp = 0;

export function detectFace(video: HTMLVideoElement): FaceDetectionResult | null {
  if (!faceInstance) return null;

  const timestamp = Math.max(performance.now(), lastFaceTimestamp + 1);
  lastFaceTimestamp = timestamp;

  try {
    const result: FaceLandmarkerResult = faceInstance.detectForVideo(video, timestamp);
    if (!result.faceLandmarks || result.faceLandmarks.length === 0) return null;

    const categories = result.faceBlendshapes?.[0]?.categories ?? [];

    return {
      blendshapes: categories.map((c) => ({
        categoryName: c.categoryName,
        score: c.score,
      })),
      landmarks: mapLandmarks(result.faceLandmarks[0]),
      timestamp,
    };
  } catch {
    // face detection failed this frame
    return null;
  }
}

export function destroy(): void {
  poseRefCount--;
  if (poseRefCount <= 0 && poseInstance) {
    poseInstance.close();
    poseInstance = null;
    poseRefCount = 0;
  }
}

export function destroyHands(): void {
  handRefCount--;
  if (handRefCount <= 0 && handInstance) {
    handInstance.close();
    handInstance = null;
    handRefCount = 0;
  }
}

export function destroyFace(): void {
  faceRefCount--;
  if (faceRefCount <= 0 && faceInstance) {
    faceInstance.close();
    faceInstance = null;
    faceRefCount = 0;
  }
}
