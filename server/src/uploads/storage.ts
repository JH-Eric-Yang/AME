/**
 * storage — where participant uploads live on disk, and what they are called
 * once they reach an export archive.
 *
 * Two write paths land in the same directory: @tus/server's FileStore (the
 * `on-stop` recorder mode and the file picker) and the Socket.IO streaming
 * handler. Both read `UploadDir` from here so the two can never drift apart.
 */

import path from "path";
import { fileURLToPath } from "url";

const Dirname = path.dirname(fileURLToPath(import.meta.url));

/** Root directory holding every participant upload. Never inside nodemon's watch. */
export const UploadDir = path.resolve(Dirname, "../../uploads");

/**
 * Where FileStore writes an upload's payload. It names the file after the tus
 * id and an Upload row carries that same id, so the path is derivable — but it
 * must still be recorded on the row, because the ZIP export selects on
 * `filePath` and silently skips any row without one.
 */
export function tusFilePath(uploadId: string): string {
  return path.join(UploadDir, uploadId);
}

/**
 * Name an upload takes inside the export archive. Recorder filenames encode
 * progress, trial and element but not who recorded them, and file-picker
 * uploads keep the participant's own filename, so a flat archive collides as
 * soon as two participants finish the same routine. One folder per participant
 * keeps every entry distinct and the archive navigable. The folder is the
 * participant's responseId, the id the CSV export uses, so a file joins to its rows.
 */
export function archiveEntryName(upload: { responseId: string; fileName: string }): string {
  return `${upload.responseId}/${upload.fileName}`;
}
