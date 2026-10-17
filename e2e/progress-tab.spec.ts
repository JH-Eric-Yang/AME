import { test, expect, type Page } from "@playwright/test";
import {
  seedProgressExperiment,
  deleteProgressExperiment,
  findContentRows,
  disconnect,
  ProgressExperimentName,
  ProgressAdminEmail,
  ProgressAdminPassword,
} from "./fixtures/seed";

/**
 * The Progress tab, end to end. The client suite has no jsdom, so this is the
 * only thing that mounts ProgressTab, StepEditor, ElementOverride and the
 * ReferencePicker, and the only check that a picked reference reaches the
 * content row the server resolves from.
 */

let experimentId: string;

test.beforeAll(async () => {
  experimentId = await seedProgressExperiment();
});

test.afterAll(async () => {
  await deleteProgressExperiment();
  await disconnect();
});

async function openProgressTab(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(ProgressAdminEmail);
  await page.getByLabel("Password").fill(ProgressAdminPassword);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL("**/admin/dashboard");
  await page.goto(`/admin/dashboard/experiment/${experimentId}`);
  await expect(page.getByRole("heading", { name: ProgressExperimentName })).toBeVisible();
  await page.getByRole("button", { name: "Progress", exact: true }).click();
  await expect(page.getByRole("button", { name: "Step 0" })).toBeVisible();
}

const step = (page: Page, n: number) => page.getByRole("button", { name: `Step ${n}` });

test.describe("progress tab", () => {
  test("picks an earlier recording as a video source and saves it", async ({ page }) => {
    await openProgressTab(page);
    await expect(page.getByRole("button", { name: /^Step \d+$/ })).toHaveCount(3);

    await step(page, 1).click();
    await page.getByLabel("Override replay").check();
    await page.getByRole("button", { name: "Earlier recording…" }).click();

    const dialog = page.getByRole("dialog", { name: "Choose a reference" });
    await dialog.getByRole("button", { name: "p0 · t1 · intro" }).click();
    await dialog.getByRole("button", { name: "clip · recorder" }).click();
    await expect(dialog.getByText("ref:self/p0/clip")).toBeVisible();
    await dialog.getByRole("button", { name: "Use reference" }).click();

    await expect(page.getByText("Earlier data")).toBeVisible();
    await expect(step(page, 1)).toContainText("self / p0 / clip");

    await page.getByRole("button", { name: "Save sequence" }).click();
    await expect(page.getByText("Saved")).toBeVisible();

    const rows = await findContentRows(experimentId);
    const recap = rows.find((r) => r.progress === 1)!;
    expect((recap.content as { replay?: { src?: string } }).replay?.src).toBe("ref:self/p0/clip");
  });

  test("rewrites the reference when a step is inserted above its target, and refuses to delete the target", async ({ page }) => {
    await openProgressTab(page);
    await expect(step(page, 1)).toContainText("self / p0 / clip");

    await step(page, 0).click();
    await page.getByRole("button", { name: "Insert above" }).click();
    await expect(page.getByText("1 reference rewritten")).toBeVisible();
    await expect(step(page, 2)).toContainText("self / p1 / clip");

    await step(page, 1).click();
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText(/Cannot delete p1: referenced by p2 replay/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Step \d+$/ })).toHaveCount(4);
  });

  test("a media source pointing at a text answer is an error that blocks saving", async ({ page }) => {
    await openProgressTab(page);
    await step(page, 1).click();
    await page.getByText("Advanced").last().click();
    const json = page.getByLabel("Content JSON");
    await json.fill(JSON.stringify({ replay: { src: "ref:self/p0/name" } }));
    await json.blur();

    await expect(page.getByRole("alert")).toContainText("1 error blocks saving");
    await expect(page.getByRole("alert")).toContainText('a media source needs a recording or file, but "name" is a input-textfield');
    await expect(page.getByRole("button", { name: "Save sequence" })).toBeDisabled();
    await expect(step(page, 1)).toContainText("1 error");
  });

  test("imports a wide CSV file whose quoted cell holds a comma", async ({ page }) => {
    await openProgressTab(page);
    await page.getByText("CSV import and export").click();
    await page.getByLabel("Upload CSV").setInputFiles({
      name: "trials.csv",
      mimeType: "text/csv",
      // Progress 99 sorts after every step, so the import appends a new step.
      buffer: Buffer.from('\uFEFFprogress,trialNumber,routine,condition,greeting.content\r\n99,1,recap,Basic,"Hello, comma world"\r\n'),
    });
    await expect(page.getByText(/1 row imported/)).toBeVisible();

    await page.getByRole("button", { name: "Save sequence" }).click();
    await expect(page.getByText("Saved")).toBeVisible();

    const rows = await findContentRows(experimentId);
    const imported = rows.filter((r) => (r.content as { greeting?: { content?: string } }).greeting?.content === "Hello, comma world");
    expect(imported).toHaveLength(1);
    expect(imported[0].content).toEqual({ greeting: { content: "Hello, comma world" } });
  });

  test("adds one step per pasted value, each with its own trial number", async ({ page }) => {
    const values = ["Alpha trial", "Beta trial", "Gamma trial"];
    await openProgressTab(page);
    const before = await page.getByRole("button", { name: /^Step \d+$/ }).count();

    await page.getByRole("button", { name: "Add trials from stimuli" }).click();
    const dialog = page.getByRole("dialog", { name: "Add trials from stimuli" });
    await dialog.getByLabel("Routine").selectOption("recap");
    await dialog.getByLabel("Element and param").selectOption("greeting.content");
    await dialog.getByLabel("Values, one on each line").fill(`${values[0]}\n\n${values[1]}\n${values[2]}`);
    await expect(dialog.getByText(/^Adds 3 steps/)).toBeVisible();
    await dialog.getByRole("button", { name: "Add", exact: true }).click();

    await expect(page.getByRole("button", { name: /^Step \d+$/ })).toHaveCount(before + 3);
    await expect(page.getByText(/add the trial range \d+–\d+ in Settings/)).toBeVisible();
    await page.getByRole("button", { name: "Save sequence" }).click();
    await expect(page.getByText("Saved")).toBeVisible();

    const rows = await findContentRows(experimentId);
    const added = rows.filter((r) => values.includes((r.content as { greeting?: { content?: string } }).greeting?.content ?? ""));
    expect(added.map((r) => r.content)).toEqual(values.map((content) => ({ greeting: { content } })));
    expect(new Set(added.map((r) => r.trialNumber)).size).toBe(3);
  });
});
