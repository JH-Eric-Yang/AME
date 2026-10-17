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
  StyledTextContent,
} from "./fixtures/seed";

/**
 * The typography round trip, end to end.
 *
 * One half proves an authored param reaches a participant's computed style;
 * the other proves the Inspector reads the same params back and that a change
 * made there is merged into the stored routine without dropping the params the
 * researcher did not touch.
 */

let experimentId: string;

test.beforeAll(async () => {
  experimentId = await seedTextStyleExperiment();
});

test.afterAll(async () => {
  await deleteTextStyleExperiment();
  await disconnect();
});

async function signIn(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(TextStyleAdminEmail);
  await page.getByLabel("Password").fill(TextStyleAdminPassword);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL("**/admin/dashboard");
}

async function openHeadlineInInspector(page: Page): Promise<void> {
  await signIn(page);
  await page.goto(`/admin/dashboard/experiment/${experimentId}`);
  await expect(page.getByRole("heading", { name: TextStyleExperimentName })).toBeVisible();
  await page.getByRole("button", { name: "Builder", exact: true }).click();
  await page.getByRole("button", { name: `${TextStyleRoutineName} card` }).click();
  // The canvas card carries aria-label={element.name}.
  await page.getByRole("button", { name: "headline", exact: true }).click();
}

test("a participant sees every authored typography param in the computed style", async ({
  page,
}) => {
  await page.goto(`/experiment/${experimentId}`);
  await page.getByRole("button", { name: "Begin Experiment" }).click();
  await page.getByRole("button", { name: "I'm Ready" }).click();

  const headline = page.getByText(StyledTextContent);
  await expect(headline).toBeVisible();

  const style = await headline.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      fontSize: s.fontSize,
      fontStyle: s.fontStyle,
      fontWeight: s.fontWeight,
      color: s.color,
      textAlign: s.textAlign,
      lineHeight: s.lineHeight,
    };
  });

  expect(style).toEqual({
    fontSize: "32px",
    fontStyle: "italic",
    fontWeight: "600",
    color: "rgb(255, 0, 0)",
    textAlign: "center",
    lineHeight: "64px", // 2 × 32px
  });
});

test("the Inspector reads the params back and a change reaches the stored routine", async ({
  page,
}) => {
  await openHeadlineInInspector(page);

  // `exact` throughout: getByLabel matches substrings, so a bare "Size" would
  // also catch "Line height"'s neighbours in a future editor.
  await expect(page.getByLabel("Size", { exact: true })).toHaveValue("32");
  await expect(page.getByLabel("Style", { exact: true })).toHaveValue("italic");

  // Scoped to the group: the button editor offers the same four labels.
  const alignment = page.getByRole("group", { name: "Alignment" });
  await expect(alignment.getByRole("button", { name: "Center" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByLabel("Size", { exact: true }).fill("40");
  await alignment.getByRole("button", { name: "Right" }).click();
  await page.getByRole("button", { name: "Save Changes" }).click();

  // Poll the row: the save is a REST call the UI does not otherwise surface.
  await expect
    .poll(async () => {
      const row = await findExperimentRow(experimentId);
      const routines = row?.routines as {
        elements: { name: string; params: Record<string, unknown> }[];
      }[];
      const headline = routines[0].elements.find((e) => e.name === "headline");
      return headline?.params;
    })
    .toMatchObject({
      content: StyledTextContent,
      fontSize: "40px",
      textAlign: "right",
      // Untouched params survive the merge — proof the patch spread is intact.
      fontStyle: "italic",
      color: "#ff0000",
    });
});
