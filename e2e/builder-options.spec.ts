import { test, expect } from "@playwright/test";
import { disconnect } from "./fixtures/seed";
import { deleteBench } from "./fixtures/seeds/common";
import { createTutorialBench } from "./tutorials/kit/bench";
import { dropElement, field, openBuilder, selectElement, signIn } from "./tutorials/kit/builder";

/**
 * The Builder's Options field (input-select and input-option-group). The
 * tutorial run found that typed options broke (E2E-D5); this test guards the fix.
 */

const OptionsLabel = "Options (one per line, as value|label)";
const TypedOptions = "red|Red\nblue|Blue";
const BenchLabel = "Options field";

let experimentId: string;

test.beforeAll(async () => {
  experimentId = await createTutorialBench(BenchLabel, "Pick a colour.");
});

test.afterAll(async () => {
  // Only this file's bench: the tutorial researcher is shared with npm run tutorials.
  await deleteBench(`Tutorial — ${BenchLabel}`);
  await disconnect();
});

test("the Options field keeps options typed one key at a time", async ({ page }) => {
  await signIn(page);
  await openBuilder(page, experimentId);
  const name = await dropElement(page, "input-select");
  await selectElement(page, name);

  const options = field(page, OptionsLabel);
  await options.click();
  await options.pressSequentially(TypedOptions);

  await expect(options).toHaveValue(TypedOptions);
});
