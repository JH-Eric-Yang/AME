import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { CacheDir, MediaRecipes } from "./mediaFiles";

const run = promisify(execFile);

/** Stop with an install hint when a required command-line tool is missing. */
export async function requireTool(tool: string): Promise<void> {
  try {
    await run(tool, ["-version"]);
  } catch {
    throw new Error(
      `${tool} is required by the e2e suite. Install ffmpeg, which includes ffprobe: ` +
        `"brew install ffmpeg" on macOS, "sudo apt-get install ffmpeg" on Debian or Ubuntu.`,
    );
  }
}

/**
 * Run ffmpeg into `out` unless the file is already there. ffmpeg writes to a
 * temporary file first, so a run that stops part of the way leaves no broken file.
 */
async function makeIfMissing(out: string, args: string[]): Promise<void> {
  try {
    await fs.access(out);
    return;
  } catch {
    // Not made yet.
  }
  const partial = `${out}.part${path.extname(out)}`;
  await run("ffmpeg", ["-v", "error", "-y", ...args, partial]);
  await fs.rename(partial, out);
}

/** Remove files that no current recipe names: old recipes and partial files. */
async function removeStaleFiles(): Promise<void> {
  const current = new Set(MediaRecipes.map((r) => path.basename(r.file)));
  for (const name of await fs.readdir(CacheDir)) {
    if (!current.has(name)) await fs.rm(path.join(CacheDir, name), { force: true });
  }
}

export default async function globalSetup(): Promise<void> {
  await requireTool("ffmpeg");
  await requireTool("ffprobe");
  await fs.mkdir(CacheDir, { recursive: true });
  await removeStaleFiles();
  for (const recipe of MediaRecipes) {
    await makeIfMissing(recipe.file, recipe.args);
  }
}
