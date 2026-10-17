import { Router } from "express";

const router = Router();

// Placeholder — Phase 2 will implement experiment public routes
router.get("/health", (_req, res) => {
  res.json({ status: "experiment ok" });
});

export default router;
