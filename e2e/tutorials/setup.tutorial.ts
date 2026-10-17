import { test } from "@playwright/test";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Tutorials } from "./definitions";
import { RunInfoFile, TutorialOutputDir } from "./kit/session";
import type { RunInfo } from "./kit/types";

const run = promisify(execFile);

/** The branch and commit of this checkout, for the pages' run details. */
async function buildName(): Promise<string> {
  try {
    const branch = (await run("git", ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
    const commit = (await run("git", ["rev-parse", "--short", "HEAD"])).stdout.trim();
    return `${branch} · ${commit}`;
  } catch {
    return "unknown";
  }
}

test("clear the tutorial output", async () => {
  await fs.rm(TutorialOutputDir, { recursive: true, force: true });
  await fs.mkdir(TutorialOutputDir, { recursive: true });
  const info: RunInfo = {
    recordedAt: new Date().toISOString(),
    build: await buildName(),
    defined: Tutorials.map((d) => d.type),
  };
  await fs.writeFile(RunInfoFile, JSON.stringify(info, null, 2));
});
