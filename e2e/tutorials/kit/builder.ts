import { expect, type Locator, type Page } from "@playwright/test";
import type { ElementType } from "ame-shared";
import { DropRow, SeededElementCount, TrialRoutine, TutorialAdminEmail, TutorialAdminPassword } from "./bench";
import { PaletteLabels } from "./types";

/**
 * The researcher's actions in the admin pages. Labels come from the Builder
 * code; `exact` matters, because several labels contain others ("Size" is in
 * "Max Size (MB)").
 */

/** Pause between typed characters, so the viewer sees the text appear. */
const TypeDelayMs = 45;

export async function signIn(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(TutorialAdminEmail);
  await page.getByLabel("Password").fill(TutorialAdminPassword);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL("**/admin/dashboard");
}

/** Open the experiment (the Builder is the first tab) and select the trial routine. */
export async function openBuilder(page: Page, experimentId: string): Promise<void> {
  await page.goto(`/admin/dashboard/experiment/${experimentId}`);
  await page.getByRole("button", { name: "Builder", exact: true }).click();
  await page.getByRole("button", { name: `${TrialRoutine} card` }).click();
  await expect(dropCell(page)).toBeVisible();
}

/** The vertical centre of an element, in page coordinates. */
const docTop = (el: Element) => {
  const box = el.getBoundingClientRect();
  return box.top + window.scrollY + box.height / 2;
};

const dropCell = (page: Page) => page.getByRole("region", { name: `Grid cell row ${DropRow} column 1` });

/** The name the Builder gives the dropped element. */
export const newElementName = (type: ElementType) => `${type}-${SeededElementCount + 1}`;

export async function dropElement(page: Page, type: ElementType): Promise<string> {
  const tile = page.getByRole("listitem", { name: PaletteLabels[type], exact: true });
  const cell = dropCell(page);
  // The Monitor tiles sit far below the drop row. Scroll to the point halfway
  // between them, so both are on screen and clear of the sticky top bar.
  const [tileBox, cellBox] = await Promise.all([tile.evaluate(docTop), cell.evaluate(docTop)]);
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), (tileBox + cellBox) / 2 - page.viewportSize()!.height / 2);
  await tile.dragTo(cell);
  const name = newElementName(type);
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  return name;
}

export async function selectElement(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

/** A labelled Inspector field. */
export const field = (page: Page, label: string): Locator => page.getByLabel(label, { exact: true });

/** Type into a field so the viewer sees each character. */
export async function typeInto(target: Locator, text: string): Promise<void> {
  await target.click();
  await target.fill("");
  await target.pressSequentially(text, { delay: TypeDelayMs });
}

/** Set a toggle field to `on`. */
export async function setToggle(page: Page, label: string, on: boolean): Promise<void> {
  const box = field(page, label);
  if ((await box.isChecked()) !== on) await box.click();
  await expect(box).toBeChecked({ checked: on });
}

/** The JSON params editor (volume-check, speech-recognizer). */
export const jsonParams = (page: Page): Locator =>
  page.getByRole("group", { name: "Parameters" }).locator("textarea");

/** Add an event; the first trigger of the type and "proceed" are the defaults. */
export async function addProceedEvent(page: Page): Promise<void> {
  const events = page.getByRole("group", { name: "Events" });
  await events.getByRole("button", { name: "+ Add Event" }).click();
  await expect(events.getByRole("combobox").nth(1)).toHaveValue("proceed");
}

export async function saveChanges(page: Page): Promise<void> {
  const save = page.getByRole("button", { name: "Save Changes" });
  await save.click();
  await expect(save).toHaveCount(0);
}

/** The participant link from the link bar. The tutorial opens it in the same page. */
export async function participantLink(page: Page): Promise<string> {
  const href = await page
    .getByRole("region", { name: "Participant link" })
    .getByRole("link", { name: "Open" })
    .getAttribute("href");
  expect(href).toBeTruthy();
  return href!;
}

/** Start as a participant: the lobby, then the first routine. Returns the responseId. */
export async function startAsParticipant(page: Page, link: string, experimentId: string): Promise<string> {
  await page.goto(link);
  await page.getByRole("button", { name: "Begin Experiment" }).click();
  await page.getByRole("button", { name: "I'm Ready" }).click();
  const responseId = await page.evaluate((id) => localStorage.getItem(`ame-responseId-${id}`), experimentId);
  expect(responseId).toBeTruthy();
  return responseId!;
}

export async function openResults(page: Page, experimentId: string): Promise<Locator> {
  await page.goto(`/admin/dashboard/experiment/${experimentId}`);
  await page.getByRole("button", { name: "Results", exact: true }).click();
  const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: TrialRoutine, exact: true }) });
  await expect(row).toHaveCount(1);
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  return row;
}
