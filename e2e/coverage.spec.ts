import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FamilyOfElement } from "ame-shared/elementFamilies";
import { ElementCoverage } from "./elementCoverage";

const E2eDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Every element type must name the e2e tests that cover it. FamilyOfElement is
 * typed Record<ElementType, …>, so its keys are every element type at runtime.
 */
test("every element type has e2e coverage", async () => {
  const coverage = ElementCoverage as Record<string, (typeof ElementCoverage)[keyof typeof ElementCoverage]>;
  const missing = Object.keys(FamilyOfElement).filter((type) => !coverage[type]?.length);
  expect(missing, "element types without an e2e coverage entry").toEqual([]);

  for (const [type, entries] of Object.entries(coverage)) {
    for (const entry of entries) {
      if ("pending" in entry) {
        test.info().annotations.push({ type: "pending", description: `${type}: ${entry.pending}` });
        continue;
      }
      const source = await fs.readFile(path.join(E2eDir, entry.file), "utf8");
      for (const title of entry.titles) {
        expect(source, `${type} names a test that is not in ${entry.file}`).toContain(`"${title}"`);
      }
    }
  }
});
