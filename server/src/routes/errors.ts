import { Router } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import * as errors from "../controllers/errors.js";

/**
 * Mounted at /api/admin. `requireAuth` is attached per route, NOT via
 * `.use(...)`: this router shares its mount path with the unauthenticated
 * `/api/admin/login` and `/signup`, exactly as `adminAssetRoutes` documents.
 */
export const adminErrorRoutes = Router();

adminErrorRoutes.get("/experiments/:id/errors", requireAuth, asyncHandler(errors.listExperimentErrors));
adminErrorRoutes.get("/errors", requireAuth, requireAdmin, asyncHandler(errors.listPlatformErrors));
adminErrorRoutes.get("/errors/:groupId/events", requireAuth, asyncHandler(errors.listGroupEvents));
adminErrorRoutes.post("/errors/:groupId/resolve", requireAuth, asyncHandler(errors.resolveGroup));
adminErrorRoutes.post("/errors/:groupId/reopen", requireAuth, asyncHandler(errors.reopenGroup));
