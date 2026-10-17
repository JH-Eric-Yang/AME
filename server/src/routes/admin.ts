import { Router } from "express";
import { requireAuth, requireAuthOrDownloadToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import * as admin from "../controllers/admin.js";

const router = Router();

// Auth (no middleware)
router.post("/signup", asyncHandler(admin.signup));
router.post("/login", asyncHandler(admin.login));

// Export downloads: a browser download cannot send a header, so these also
// accept a download token from POST /experiments/:id/export/token.
router.get("/experiments/:id/export/csv", requireAuthOrDownloadToken, asyncHandler(admin.exportCsv));
router.get("/experiments/:id/export/files", requireAuthOrDownloadToken, asyncHandler(admin.exportFiles));
router.get("/experiments/:id/export/json", requireAuthOrDownloadToken, asyncHandler(admin.exportJson));

// Protected routes
router.use(requireAuth);

// Me
router.get("/me", asyncHandler(admin.getMe));

// Accounts
router.get("/accounts", asyncHandler(admin.listAccounts));
router.post("/accounts/:id/approve", asyncHandler(admin.approveAccount));
router.post("/accounts/:id/reject", asyncHandler(admin.rejectAccount));

// Experiments
router.get("/experiments", asyncHandler(admin.listExperiments));
router.post("/experiments/import/json", asyncHandler(admin.importJson));
router.get("/experiments/:id", asyncHandler(admin.getExperiment));
router.post("/experiments", asyncHandler(admin.createExperiment));
router.put("/experiments/:id", asyncHandler(admin.updateExperiment));
router.delete("/experiments/:id", asyncHandler(admin.deleteExperiment));
router.put("/experiments/:id/visibility", asyncHandler(admin.toggleVisibility));

// Participants
router.get("/experiments/:id/participants", asyncHandler(admin.listParticipants));
router.get("/participants/:id", asyncHandler(admin.getParticipant));
router.delete("/participants/:id", asyncHandler(admin.deleteParticipant));
router.post("/experiments/:id/match-participants", asyncHandler(admin.manualMatch));
router.get("/experiments/:id/sessions", asyncHandler(admin.listSessions));

// Content
router.get("/experiments/:id/content", asyncHandler(admin.listContent));
router.post("/experiments/:id/content", asyncHandler(admin.uploadContent));
router.put("/experiments/:id/content", asyncHandler(admin.replaceContent));
router.delete("/experiments/:id/content", asyncHandler(admin.clearContent));
router.put("/experiments/:id/content/all", asyncHandler(admin.saveContent));

// Results & Export
router.get("/experiments/:id/results", asyncHandler(admin.listResults));
router.post("/experiments/:id/export/token", asyncHandler(admin.createDownloadToken));

export default router;
