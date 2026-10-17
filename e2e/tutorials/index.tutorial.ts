import { test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import type { ElementType } from "ame-shared";
import { FamilyOfElement } from "ame-shared/elementFamilies";
import { ElementCoverage } from "../elementCoverage";
import { disconnect } from "../fixtures/seed";
import { Tutorials } from "./definitions";
import { deleteTutorialBenches } from "./kit/bench";
import { indexEntries, renderIndex } from "./kit/render";
import { readRunInfo, TutorialOutputDir } from "./kit/session";
import type { TutorialManifest } from "./kit/types";

/**
 * The teardown of the tutorial run. It runs after the tutorials even when
 * some failed, so the index lists every element with its result.
 */

async function readManifest(type: ElementType): Promise<TutorialManifest | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(TutorialOutputDir, type, "manifest.json"), "utf8")) as TutorialManifest;
  } catch {
    return null;
  }
}

/** The phase that adds the element's tests, from its pending coverage entry. */
function plannedNote(type: ElementType): string {
  const pending = ElementCoverage[type].find((entry) => "pending" in entry);
  return pending && "pending" in pending ? pending.pending : "no tutorial yet";
}

test("write the tutorial index", async () => {
  const types = Object.keys(FamilyOfElement) as ElementType[];
  const manifests = (await Promise.all(types.map(readManifest))).filter((m): m is TutorialManifest => m !== null);
  const entries = indexEntries(types, manifests, Tutorials.map((d) => d.type), plannedNote);
  await fs.mkdir(TutorialOutputDir, { recursive: true });
  await fs.writeFile(path.join(TutorialOutputDir, "index.html"), renderIndex(entries, await readRunInfo()));
  await deleteTutorialBenches();
  await disconnect();
});
