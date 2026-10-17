import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import {
  seedMediaExperiment,
  deleteMediaExperiment,
  disconnect,
  MediaExperimentName,
  MediaAdminEmail,
  MediaAdminPassword,
  MediaRoutineName,
} from "./fixtures/seed";

/**
 * The media library, end to end.
 *
 * The client suite has no jsdom, so MediaTab, AssetGrid, MediaSourceField and
 * AssetPickerDialog are never mounted by a unit test — this spec is the only
 * thing that executes them, and the only check that an uploaded file actually
 * reaches a participant's screen.
 */

let experimentId: string;

const StimFile = path.join(import.meta.dirname, "fixtures", "stim.png");

test.beforeAll(async () => {
  experimentId = await seedMediaExperiment();
});

test.afterAll(async () => {
  await deleteMediaExperiment();
  await disconnect();
});

async function signIn(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(MediaAdminEmail);
  await page.getByLabel("Password").fill(MediaAdminPassword);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL("**/admin/dashboard");
}

async function openMediaTab(page: Page): Promise<void> {
  await signIn(page);
  await page.goto(`/admin/dashboard/experiment/${experimentId}`);
  await expect(page.getByRole("heading", { name: MediaExperimentName })).toBeVisible();
  await page.getByRole("button", { name: "Media", exact: true }).click();
}

test.describe("media library", () => {
  test("uploads a file, assigns it to an element, and a participant sees it", async ({
    page,
    browser,
  }) => {
    await openMediaTab(page);

    await expect(page.getByText("No media yet.")).toBeVisible();

    await page.locator('input[type="file"]').first().setInputFiles(StimFile);

    // The grid refreshes once the upload completes.
    await expect(page.getByText("stim.png")).toBeVisible();
    await expect(page.getByText("unused")).toBeVisible();

    // Assign it in the Builder. The tab auto-selects the first routine, but
    // pick this one explicitly so the test does not depend on its position in
    // the tree. Match the tree's button rather than the bare name: the
    // Inspector heads the selected routine with the same text.
    await page.getByRole("button", { name: "Builder", exact: true }).click();
    await page.getByRole("button", { name: `${MediaRoutineName} card` }).click();
    // The canvas card no longer prints the element's name as body text (it
    // now previews the element itself), so select it by its accessible name
    // instead — the card carries aria-label={element.name}.
    await page.getByRole("button", { name: "stim", exact: true }).click();
    await expect(page.getByText("No source set — this element will render blank")).toBeVisible();

    await page.getByRole("button", { name: "Choose from library…" }).click();
    await page.getByRole("dialog", { name: "Choose media" }).getByText("stim.png").click();

    // The field now shows the chosen file rather than the empty warning.
    await expect(page.getByText("No source set — this element will render blank")).toHaveCount(0);

    await page.getByRole("button", { name: "Save Changes" }).click();

    // A participant loads the same bytes from the public endpoint. A fresh
    // browser context, not a tab in the admin's own context — the participant
    // must not inherit the signed-in admin's session or localStorage.
    const participantContext = await browser.newContext();
    const participant = await participantContext.newPage();
    await participant.goto(`/experiment/${experimentId}`);
    await participant.getByRole("button", { name: "Begin Experiment" }).click();
    await participant.getByRole("button", { name: "I'm Ready" }).click();

    const stimulus = participant.locator("img").first();
    await expect(stimulus).toBeVisible();
    await expect(stimulus).toHaveAttribute("src", /\/api\/assets\//);

    // Proof the image actually loaded, not merely that the tag rendered.
    const loaded = await stimulus.evaluate(
      (img) => (img as HTMLImageElement).naturalWidth > 0,
    );
    expect(loaded).toBe(true);

    await participantContext.close();
  });

  test("counts an asset's uses and warns before deleting it", async ({ page }) => {
    await openMediaTab(page);

    await expect(page.getByText("used 1x")).toBeVisible();

    page.once("dialog", (dialog) => {
      expect(dialog.message()).toContain("media-trial/stim");
      dialog.dismiss();
    });
    await page.getByRole("button", { name: "Delete" }).first().click();

    // Dismissed, so it is still there.
    await expect(page.getByText("stim.png")).toBeVisible();
  });
});
