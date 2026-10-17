import { test, expect, type Page } from "@playwright/test";
import {
  seedTestExperiment,
  deleteTestExperiment,
  findResults,
  findParticipant,
  disconnect,
} from "../fixtures/seed";
import { responsesByRoutine, startExperiment as startBench } from "../fixtures/participant";
import {
  CityDefault,
  deleteResponseBench,
  ResponseMarkers,
  seedResponseBench,
  SliderDefault,
  SliderMax,
} from "../fixtures/seeds/response";

let experimentId: string;

test.beforeAll(async () => {
  experimentId = await seedTestExperiment();
});

test.afterAll(async () => {
  await deleteTestExperiment();
  await disconnect();
});

/**
 * Walk from the lobby into the first routine.
 *
 * @returns the participant's responseId, so assertions can scope database
 *          lookups to this run rather than every participant the suite created.
 */
async function startExperiment(page: Page): Promise<string> {
  await page.goto(`/experiment/${experimentId}`);
  await page.getByRole("button", { name: "Begin Experiment" }).click();
  await page.getByRole("button", { name: "I'm Ready" }).click();
  await expect(page.getByText("Keyboard trial")).toBeVisible();

  const responseId = await page.evaluate(
    (id) => localStorage.getItem(`ame-responseId-${id}`),
    experimentId,
  );
  expect(responseId).toBeTruthy();
  return responseId!;
}

test.describe("Phase 13 elements", () => {
  test("keyboard element records a keypress and its press trigger proceeds", async ({
    page,
  }) => {
    await startExperiment(page);

    await page.keyboard.press("f");

    // Advancing to the next routine is the proof the press trigger fired.
    await expect(page.getByText("Choose your answers")).toBeVisible();
  });

  test("keyboard element ignores keys outside the allowlist", async ({ page }) => {
    await startExperiment(page);

    await page.keyboard.press("q");
    await expect(page.getByText("Keyboard trial")).toBeVisible();

    await page.keyboard.press("j");
    await expect(page.getByText("Choose your answers")).toBeVisible();
  });

  test("option group records radio and checkbox answers", async ({ page }) => {
    await startExperiment(page);
    await page.keyboard.press("f");
    await expect(page.getByText("Choose your answers")).toBeVisible();

    await page.getByRole("radio", { name: "Blue" }).check();
    await page.getByRole("checkbox", { name: "Apple" }).check();
    await page.getByRole("checkbox", { name: "Pear" }).check();

    await expect(page.getByRole("radio", { name: "Blue" })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Apple" })).toBeChecked();

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Upload a file")).toBeVisible();
  });

  test("checkbox group deselects on a second click", async ({ page }) => {
    await startExperiment(page);
    await page.keyboard.press("f");

    const apple = page.getByRole("checkbox", { name: "Apple" });
    await apple.check();
    await expect(apple).toBeChecked();

    await apple.uncheck();
    await expect(apple).not.toBeChecked();
  });

  test("file picker uploads the chosen file through tus", async ({ page }) => {
    await startExperiment(page);
    await page.keyboard.press("f");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Upload a file")).toBeVisible();

    await page.locator('input[type="file"]').setInputFiles({
      name: "response.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("participant supplied content"),
    });

    await expect(page.getByText("response.txt")).toBeVisible();
    // "Uploaded" only appears once tus reports success from the server.
    await expect(page.getByText("Uploaded")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("What should we call you?")).toBeVisible();
  });

  test("survey element renders SurveyJS and proceeds on submit", async ({ page }) => {
    await startExperiment(page);
    await page.keyboard.press("f");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("What should we call you?")).toBeVisible();

    await page.locator("input[type='text']").first().fill("Robin");
    await page.getByRole("button", { name: "Submit" }).click();

    await expect(page.getByText("Trigger an alert")).toBeVisible();
  });

  test("alert event pauses with a message and records a data event", async ({
    page,
  }) => {
    const responseId = await startExperiment(page);
    await page.keyboard.press("f");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.locator("input[type='text']").first().fill("Robin");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Trigger an alert")).toBeVisible();

    await page.getByRole("button", { name: "Raise alert" }).click();
    await expect(page.getByText("Alert raised")).toBeVisible();

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Pick a language")).toBeVisible();
    await page.getByRole("combobox").selectOption("en");
    await expect(page.getByText("All done")).toBeVisible();

    // The alert must have been recorded alongside pausing, per the AME spec.
    const results = await findResults(experimentId, responseId);
    const alertRow = results.find((r) => r.routine === "alert-trial");
    expect(alertRow).toBeDefined();

    const response = alertRow!.response as Record<string, unknown>;
    expect(response.alarm_alert).toMatchObject({
      message: "Alert raised",
      count: 1,
    });
    expect(typeof (response.alarm_alert as Record<string, unknown>).timestamp).toBe(
      "number",
    );
  });

  test("a select's change trigger proceeds and records the choice", async ({
    page,
  }) => {
    const responseId = await startExperiment(page);
    await page.keyboard.press("f");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("What should we call you?")).toBeVisible();
    await page.locator("input[type='text']").first().fill("Alex");
    await page.getByRole("button", { name: "Submit" }).click();
    await page.getByRole("button", { name: "Next" }).click();

    await expect(page.getByText("Pick a language")).toBeVisible();
    await page.getByRole("combobox").selectOption("en");

    // Advancing is the proof the change trigger fired.
    await expect(page.getByText("All done")).toBeVisible();

    const results = await findResults(experimentId, responseId);
    const row = results.find((r) => r.routine === "change-trial");
    expect(row?.response).toMatchObject({ language: "en" });
  });

  test("the end routine's Finish button completes the experiment", async ({ page }) => {
    const responseId = await startExperiment(page);
    await page.keyboard.press("f");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("What should we call you?")).toBeVisible();
    await page.locator("input[type='text']").first().fill("Jo");
    await page.getByRole("button", { name: "Submit" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("combobox").selectOption("en");
    await expect(page.getByText("All done")).toBeVisible();

    await page.getByRole("button", { name: "Finish" }).click();

    // The participant must see confirmation, not a button that appears inert.
    await expect(page.getByText("Thank You")).toBeVisible();
    await expect(page.getByRole("button", { name: "Finish" })).toHaveCount(0);

    const participant = await findParticipant(experimentId, responseId);
    expect(participant?.completion).toBe(true);
  });

  test("a full run persists every element's response to the database", async ({
    page,
  }) => {
    const responseId = await startExperiment(page);

    await page.keyboard.press("j");
    await page.getByRole("radio", { name: "Red" }).check();
    await page.getByRole("checkbox", { name: "Pear" }).check();
    await page.getByRole("button", { name: "Next" }).click();

    await page.locator('input[type="file"]').setInputFiles({
      name: "answer.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello"),
    });
    await expect(page.getByText("Uploaded")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Next" }).click();

    await expect(page.getByText("What should we call you?")).toBeVisible();
    await page.locator("input[type='text']").first().fill("Sam");
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByText("Trigger an alert")).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Pick a language")).toBeVisible();
    await page.getByRole("combobox").selectOption("ja");
    await expect(page.getByText("All done")).toBeVisible();

    const results = await findResults(experimentId, responseId);
    const byRoutine = new Map(results.map((r) => [r.routine, r.response as Record<string, unknown>]));

    expect(byRoutine.get("keyboard-trial")).toMatchObject({
      response: { key: "j" },
    });

    expect(byRoutine.get("options-trial")).toMatchObject({
      colour: "red",
      fruits: ["pear"],
    });

    const upload = (byRoutine.get("file-trial")?.upload ?? []) as Record<string, unknown>[];
    expect(upload).toHaveLength(1);
    expect(upload[0]).toMatchObject({ name: "answer.txt", status: "complete" });

    // Survey answers land under their question name and grouped under the element.
    expect(byRoutine.get("survey-trial")).toMatchObject({
      nickname: "Sam",
      questionnaire: { nickname: "Sam" },
    });

    expect(byRoutine.get("change-trial")).toMatchObject({ language: "ja" });
  });
});

test.describe("response elements", () => {
  let benchId: string;

  test.beforeAll(async () => {
    benchId = await seedResponseBench();
  });

  test.afterAll(async () => {
    await deleteResponseBench();
  });

  const Order = [
    ResponseMarkers.button,
    ResponseMarkers.textfield,
    ResponseMarkers.textDefault,
    ResponseMarkers.sliderKeys,
    ResponseMarkers.sliderDrag,
    ResponseMarkers.defaults,
  ];

  /** Start, leave each routine before `target` without an answer, and wait until `target` shows. */
  async function goTo(page: Page, target: (typeof Order)[number]): Promise<string> {
    const responseId = await startBench(page, benchId, ResponseMarkers.button);
    for (const current of Order) {
      await expect(page.getByText(current, { exact: true })).toBeVisible();
      if (current === target) return responseId;
      const label = current === ResponseMarkers.button ? "Agree" : "Next";
      await page.getByRole("button", { name: label }).click();
    }
    return responseId;
  }

  /** Click Next and wait for `nextMarker`, so the routine's data is stored. */
  async function proceedTo(page: Page, nextMarker: string): Promise<void> {
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText(nextMarker, { exact: true })).toBeVisible();
  }

  const stored = (responseId: string, routine: string) => async () =>
    (await responsesByRoutine(benchId, responseId)).get(routine);

  test("button records its value and proceeds", async ({ page }) => {
    const responseId = await goTo(page, ResponseMarkers.button);
    await page.getByRole("button", { name: "Agree" }).click();
    await expect(page.getByText(ResponseMarkers.textfield, { exact: true })).toBeVisible();
    await expect.poll(stored(responseId, "button-trial")).toMatchObject({ agree: "yes" });
  });

  test("textfield records typed text", async ({ page }) => {
    const responseId = await goTo(page, ResponseMarkers.textfield);
    await page.getByPlaceholder("Your nickname").fill("Ada");
    await proceedTo(page, ResponseMarkers.textDefault);
    await expect.poll(stored(responseId, "textfield-trial")).toMatchObject({ nickname: "Ada" });
  });

  test("textfield records its default when the participant does not type", async ({ page }) => {
    const responseId = await goTo(page, ResponseMarkers.textDefault);
    await expect(page.locator("input[type='text']")).toHaveValue(CityDefault);
    await proceedTo(page, ResponseMarkers.sliderKeys);
    await expect.poll(stored(responseId, "textfield-default-trial")).toMatchObject({ city: CityDefault });
  });

  test("slider records the value set with the arrow keys", async ({ page }) => {
    const responseId = await goTo(page, ResponseMarkers.sliderKeys);
    const slider = page.getByRole("slider");
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveValue(String(SliderDefault + 2));
    await proceedTo(page, ResponseMarkers.sliderDrag);
    await expect.poll(stored(responseId, "slider-keys-trial")).toMatchObject({ rating: SliderDefault + 2 });
  });

  test("slider records its default when the participant does not move it", async ({ page }) => {
    const responseId = await goTo(page, ResponseMarkers.sliderKeys);
    await proceedTo(page, ResponseMarkers.sliderDrag);
    await expect.poll(stored(responseId, "slider-keys-trial")).toMatchObject({ rating: SliderDefault });
  });

  test("slider records the value set by a drag to the end", async ({ page }) => {
    const responseId = await goTo(page, ResponseMarkers.sliderDrag);
    const box = (await page.getByRole("slider").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 20, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await proceedTo(page, ResponseMarkers.defaults);
    await expect.poll(stored(responseId, "slider-drag-trial")).toMatchObject({ intensity: SliderMax });
  });

  test("select and option group record their defaults", async ({ page }) => {
    const responseId = await goTo(page, ResponseMarkers.defaults);
    await expect(page.getByRole("combobox")).toHaveValue("ja");
    await expect(page.getByRole("radio", { name: "Blue" })).toBeChecked();
    await proceedTo(page, ResponseMarkers.done);
    await expect.poll(stored(responseId, "defaults-trial")).toMatchObject({ language: "ja", colour: "blue" });
  });
});
