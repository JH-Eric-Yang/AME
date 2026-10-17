import { test, expect, type Page } from "@playwright/test";
import {
  seedProgressExperiment,
  deleteProgressExperiment,
  disconnect,
  ProgressExperimentName,
  ProgressAdminEmail,
  ProgressAdminPassword,
} from "./fixtures/seed";

/**
 * The participant link the admin pages show and copy. The link logic is
 * unit-tested in participantLink.test.ts; this proves the experiment page and
 * the dashboard card wire it to the real experiment and the clipboard.
 */

let experimentId: string;

test.beforeAll(async () => {
  experimentId = await seedProgressExperiment();
});

test.afterAll(async () => {
  await deleteProgressExperiment();
  await disconnect();
});

async function signIn(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(ProgressAdminEmail);
  await page.getByLabel("Password").fill(ProgressAdminPassword);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL("**/admin/dashboard");
}

const expectedLink = (page: Page) => `${new URL(page.url()).origin}/experiment/${experimentId}`;

test("the experiment page shows the participant link and what blocks it", async ({ page }) => {
  await signIn(page);
  await page.goto(`/admin/dashboard/experiment/${experimentId}`);
  await expect(page.getByRole("heading", { name: ProgressExperimentName })).toBeVisible();

  const bar = page.getByRole("region", { name: "Participant link" });
  await expect(bar.getByText(expectedLink(page), { exact: true })).toBeVisible();
  await expect(bar.getByRole("status")).toHaveCount(0);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Visible to participants").uncheck();
  await expect(bar.getByRole("status")).toHaveText([
    'Participants cannot open this link. Turn on "Visible to participants" in Settings.',
    "Participants get the saved version. Click Save Changes first.",
  ]);
});

test("the dashboard card copies the link without opening the experiment", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page);

  const card = page.getByRole("link").filter({ hasText: ProgressExperimentName });
  await card.hover();
  await card.getByRole("button", { name: "Copy link" }).click();
  await expect(card.getByRole("button", { name: "Copied" })).toBeVisible();

  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expectedLink(page));
});
