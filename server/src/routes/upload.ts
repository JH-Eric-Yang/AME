import { Router } from "express";
import { Server as TusServer } from "@tus/server";
import { FileStore } from "@tus/file-store";
import { UploadDir } from "../uploads/storage.js";
import { recordUploadStarted, recordUploadFinished } from "../uploads/tusHooks.js";

const tusServer = new TusServer({
  path: "/api/upload",
  datastore: new FileStore({ directory: UploadDir }),
  onUploadCreate: (_req, upload) => recordUploadStarted(upload),
  onUploadFinish: (_req, upload) => recordUploadFinished(upload),
});

const router = Router();

// Handle all tus requests
router.all("*", (req, res) => {
  tusServer.handle(req, res);
});

export default router;
