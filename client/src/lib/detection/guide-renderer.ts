import type { RoutinePosCheckConfig } from "ame-shared";
import type { ValidationResult, NormalizedLandmark } from "./fov-validator";

const PassColor = "rgba(0, 180, 0, 0.7)";
const FailColor = "rgba(220, 0, 0, 0.7)";
const LineWidth = 2;
const LandmarkRadius = 4;

export function renderGuides(
  ctx: CanvasRenderingContext2D,
  result: ValidationResult,
  config: RoutinePosCheckConfig,
  landmarks: NormalizedLandmark[],
  frameSize: { width: number; height: number },
): void {
  ctx.clearRect(0, 0, frameSize.width, frameSize.height);

  switch (config.mode) {
    case "legacy":
      renderLegacy(ctx, result, landmarks, frameSize);
      break;
    case "preset":
    case "custom":
      renderLandmarkDots(ctx, result, landmarks, frameSize);
      break;
    case "distance":
      renderDistance(ctx, result, landmarks, frameSize);
      break;
  }
}

function renderLegacy(
  ctx: CanvasRenderingContext2D,
  result: ValidationResult,
  landmarks: NormalizedLandmark[],
  size: { width: number; height: number },
): void {
  const faceLineY = size.height * 0.4;
  const wristLineY = size.height * 0.8;

  // Determine per-zone pass/fail from landmark statuses
  const faceStatuses = result.landmarks.filter((s) => s.index <= 10);
  const wristStatuses = result.landmarks.filter((s) => s.index === 15 || s.index === 16);
  const faceOk = faceStatuses.length > 0 && faceStatuses.every((s) => s.detected && s.inBounds);
  const wristsOk = wristStatuses.length > 0 && wristStatuses.every((s) => s.detected && s.inBounds);

  // Draw face boundary line
  ctx.strokeStyle = faceOk ? PassColor : FailColor;
  ctx.lineWidth = LineWidth;
  ctx.setLineDash([8, 4]);
  ctx.beginPath();
  ctx.moveTo(0, faceLineY);
  ctx.lineTo(size.width, faceLineY);
  ctx.stroke();

  // Draw wrist boundary line
  ctx.strokeStyle = wristsOk ? PassColor : FailColor;
  ctx.beginPath();
  ctx.moveTo(0, wristLineY);
  ctx.lineTo(size.width, wristLineY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw landmark dots for face and wrists
  const relevantIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 16];
  for (const idx of relevantIndices) {
    const lm = landmarks[idx];
    if (lm && lm.visibility >= 0.5) {
      const x = (1 - lm.x) * size.width; // mirrored
      const y = lm.y * size.height;
      const status = result.landmarks.find((s) => s.index === idx);
      ctx.fillStyle = status?.detected && status?.inBounds ? PassColor : FailColor;
      ctx.beginPath();
      ctx.arc(x, y, LandmarkRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function renderLandmarkDots(
  ctx: CanvasRenderingContext2D,
  result: ValidationResult,
  landmarks: NormalizedLandmark[],
  size: { width: number; height: number },
): void {
  for (const status of result.landmarks) {
    const lm = landmarks[status.index];
    if (lm && lm.visibility >= 0.3) {
      const x = (1 - lm.x) * size.width; // mirrored
      const y = lm.y * size.height;
      ctx.fillStyle = status.detected && status.inBounds ? PassColor : FailColor;
      ctx.beginPath();
      ctx.arc(x, y, LandmarkRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Draw bounding box around all required landmarks
  const validPoints = result.landmarks
    .filter((s) => {
      const lm = landmarks[s.index];
      return lm && lm.visibility >= 0.3;
    })
    .map((s) => {
      const lm = landmarks[s.index];
      return { x: (1 - lm.x) * size.width, y: lm.y * size.height };
    });

  if (validPoints.length >= 2) {
    const minX = Math.min(...validPoints.map((p) => p.x)) - 10;
    const maxX = Math.max(...validPoints.map((p) => p.x)) + 10;
    const minY = Math.min(...validPoints.map((p) => p.y)) - 10;
    const maxY = Math.max(...validPoints.map((p) => p.y)) + 10;

    ctx.strokeStyle = result.passed ? PassColor : FailColor;
    ctx.lineWidth = LineWidth;
    ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
  }
}

function renderDistance(
  ctx: CanvasRenderingContext2D,
  result: ValidationResult,
  landmarks: NormalizedLandmark[],
  size: { width: number; height: number },
): void {
  // Draw face bounding box
  const faceIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const facePoints = faceIndices
    .filter((i) => landmarks[i] && landmarks[i].visibility >= 0.5)
    .map((i) => ({
      x: (1 - landmarks[i].x) * size.width,
      y: landmarks[i].y * size.height,
    }));

  if (facePoints.length >= 3) {
    const minX = Math.min(...facePoints.map((p) => p.x)) - 8;
    const maxX = Math.max(...facePoints.map((p) => p.x)) + 8;
    const minY = Math.min(...facePoints.map((p) => p.y)) - 8;
    const maxY = Math.max(...facePoints.map((p) => p.y)) + 8;

    ctx.strokeStyle = result.passed ? PassColor : FailColor;
    ctx.lineWidth = LineWidth;
    ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);

    // Draw ratio text
    if (result.faceRatio != null) {
      const pct = (result.faceRatio * 100).toFixed(0);
      const label = `${pct}%`;
      ctx.font = "16px monospace";
      ctx.fillStyle = result.passed ? PassColor : FailColor;
      ctx.fillText(label, minX, minY - 6);
    }
  }
}
