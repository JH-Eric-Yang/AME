import { test, expect } from "@playwright/test";
import { disconnect } from "./fixtures/seed";
import { startExperiment } from "./fixtures/participant";
import { card, createBench, deleteBench, endRoutine, marker } from "./fixtures/seeds/common";
import { createTutorialBench } from "./tutorials/kit/bench";
import { dropElement, field, openBuilder, selectElement, signIn } from "./tutorials/kit/builder";

/**
 * The timer's Duration. The timer counts seconds. The tutorial run found that
 * the Inspector and the help said milliseconds (E2E-D6), and that a timer
 * with no Duration showed NaN (E2E-D7); these tests guard both fixes.
 */

const UnitsBench = "E2E — Timer Units";
const UnitsMarker = "Timer units bench";
const UnitsDone = "Timer units bench done";
/** Three seconds. */
const DurationSeconds = 3;

const DefaultBench = "E2E — Timer Default";
const DefaultMarker = "Timer default bench";
/** One tick of the countdown, and a little more. */
const TickMs = 1_500;

const FieldBench = "Timer field";

let unitsId: string;
let defaultId: string;
let fieldId: string;

test.beforeAll(async () => {
  unitsId = await createBench(UnitsBench, [
    card("timer-units-trial", [
      marker(UnitsMarker),
      {
        name: "countdown",
        type: "timer",
        params: { duration: DurationSeconds, format: "seconds" },
        events: [{ trigger: "timeout", type: "proceed" }],
      },
    ]),
    endRoutine(UnitsDone),
  ]);
  // A timer as the palette drops it: no params at all.
  defaultId = await createBench(DefaultBench, [
    card("timer-default-trial", [
      marker(DefaultMarker),
      { name: "countdown", type: "timer", params: {}, events: [{ trigger: "timeout", type: "proceed" }] },
    ]),
    endRoutine("Timer default bench done"),
  ]);
  fieldId = await createTutorialBench(FieldBench, "Wait for the timer.");
});

test.afterAll(async () => {
  await deleteBench(UnitsBench);
  await deleteBench(DefaultBench);
  // Only this file's bench: the tutorial researcher is shared with npm run tutorials.
  await deleteBench(`Tutorial — ${FieldBench}`);
  await disconnect();
});

test("a timer of 3 s ends after about 3 seconds", async ({ page }) => {
  await startExperiment(page, unitsId, UnitsMarker);
  await expect(page.getByText(UnitsDone, { exact: true })).toBeVisible({ timeout: 8_000 });
});

test("the Inspector gives the timer Duration in seconds [E2E-D6]", async ({ page }) => {
  await signIn(page);
  await openBuilder(page, fieldId);
  const name = await dropElement(page, "timer");
  await selectElement(page, name);
  await expect(field(page, "Duration (s)")).toHaveValue("60");
  await expect(field(page, "Warning at (s, blank = none)")).toBeVisible();
});

test("a timer dropped without a Duration counts down from 60 seconds [E2E-D7]", async ({ page }) => {
  await startExperiment(page, defaultId, DefaultMarker);
  await page.waitForTimeout(TickMs);
  await expect(page.getByText(/NaN/)).toHaveCount(0);
  await expect(page.getByText(/^0:5\d$/)).toBeVisible();
});
