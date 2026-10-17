import { Router } from "express";
import { serveUpload } from "../controllers/uploads.js";
import { asyncHandler } from "../middleware/errorHandler.js";

/**
 * Participant-facing upload delivery: `GET /api/uploads/:uploadId?token=…`.
 * Distinct from `/api/upload` (singular), which is the tus ingest endpoint.
 */
export const publicUploadRoutes = Router();

publicUploadRoutes.get("/:uploadId", asyncHandler(serveUpload));
