import { test, expect, type Page } from "@playwright/test";
import {
  seedTextStyleExperiment,
  deleteTextStyleExperiment,
  findExperimentRow,
  disconnect,
  TextStyleAdminEmail,
  TextStyleAdminPassword,
  TextStyleExperimentName,
  TextStyleRoutineName,
} from "./fixtures/seed";

/**
 * The Builder's column controls, end to end. Reuses the text-style bench: one
 * card routine whose single row holds `headline` and the next button in
 * column 1. `removeColumn`'s element remap is unit-tested in rowSplit.test.ts;
 * this proves the canvas wires it, and that the store write keeps the element.
 */

let experimentId: string;

test.beforeAll(async () => {
  experimentId = await seedTextStyleExperiment();
});

test.afterAll(async () => {
  await deleteTextStyleExperiment();
  await disconnect();
});

async function openRoutine(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(TextStyleAdminEmail);
  await page.getByLabel("Password").fill(TextStyleAdminPassword);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL("**/admin/dashboard");
  await page.goto(`/admin/dashboard/experiment/${experimentId}`);
  await expect(page.getByRole("heading", { name: TextStyleExperimentName })).toBeVisible();
  await page.getByRole("button", { name: "Builder", exact: true }).click();
  await page.getByRole("button", { name: `${TextStyleRoutineName} card` }).click();
}

type StoredElement = { name: string; position?: { row: number; column: number; order?: number } };
type StoredRoutine = { layout: { rows: { columns: { span: number }[] }[] }; elements: StoredElement[] };

test("removing a column moves its elements into the column on its left", async ({ page }) => {
  await openRoutine(page);

  await page.getByRole("button", { name: "+ Column" }).click();
  await expect(page.getByText("Column 2 · 6/12")).toBeVisible();

  const secondCell = page.getByRole("region", { name: "Grid cell row 1 column 2" });
  await page.getByRole("button", { name: "headline", exact: true }).dragTo(secondCell);
  await expect(secondCell.getByRole("button", { name: "headline", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Remove column 2 of row 1" }).click();
  await expect(page.getByRole("region", { name: "Grid cell row 1 column 2" })).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Grid cell row 1 column 1" }).getByRole("button", { name: "headline", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect
    .poll(async () => {
      const routine = ((await findExperimentRow(experimentId))?.routines as StoredRoutine[])[0];
      const headline = routine.elements.find((e) => e.name === "headline")?.position;
      const others = routine.elements.filter((e) => e.name !== "headline").map((e) => e.position?.order ?? 0);
      return {
        columns: routine.layout.rows[0].columns,
        cell: headline && [headline.row, headline.column],
        // The moved element goes after the elements that were already in the column.
        afterTheOthers: (headline?.order ?? 0) > Math.max(...others),
      };
    })
    .toEqual({ columns: [{ span: 12 }], cell: [0, 0], afterTheOthers: true });
});
