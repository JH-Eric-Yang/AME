import { test, expect } from "@playwright/test";
import { seedLayoutExperiment, deleteLayoutExperiment, disconnect } from "./fixtures/seed";

let experimentId: string;

test.beforeAll(async () => {
  experimentId = await seedLayoutExperiment();
});

test.afterAll(async () => {
  await deleteLayoutExperiment();
  await disconnect();
});

/**
 * The lobby requires two clicks — "Begin Experiment" then "I'm Ready" — before
 * the first routine mounts. Matches the `startExperiment` helper in
 * elements/response.spec.ts, device-screen.spec.ts, media.spec.ts and
 * finish-and-identity.spec.ts.
 */
async function enterExperiment(page: import("@playwright/test").Page): Promise<void> {
  await page.goto(`/experiment/${experimentId}`);
  await page.getByRole("button", { name: "Begin Experiment" }).click();
  await page.getByRole("button", { name: "I'm Ready" }).click();
}

test("a 6:6 row renders as two side-by-side columns, not a stack", async ({ page }) => {
  await enterExperiment(page);

  const left = page.getByText("Column one content");
  const right = page.getByText("Column two content");
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();

  const leftBox = await left.boundingBox();
  const rightBox = await right.boundingBox();
  if (!leftBox || !rightBox) throw new Error("Both columns must be laid out");

  // Side by side: the right column starts after the left one ends.
  expect(rightBox.x).toBeGreaterThan(leftBox.x + leftBox.width - 1);

  // On the same line: their vertical centres agree within a few pixels.
  const leftCentre = leftBox.y + leftBox.height / 2;
  const rightCentre = rightBox.y + rightBox.height / 2;
  expect(Math.abs(leftCentre - rightCentre)).toBeLessThan(8);
});

test("an element ordered second within a cell renders below the first", async ({ page }) => {
  await enterExperiment(page);

  const first = page.getByText("Column one content");
  const second = page.getByRole("button", { name: "Advance the layout bench" });
  const right = page.getByText("Column two content");

  await expect(first).toBeVisible();
  await expect(second).toBeVisible();

  const firstBox = await first.boundingBox();
  const secondBox = await second.boundingBox();
  const rightBox = await right.boundingBox();
  if (!firstBox || !secondBox || !rightBox) throw new Error("Both cell elements must be laid out");

  // Below the first element, in reading order within the cell.
  expect(secondBox.y).toBeGreaterThan(firstBox.y);

  // Same column as the first element, not spilled into the right column.
  // `.el-button` centres itself within its own cell (see ElButton.svelte), so
  // its left edge does not line up with the left-aligned text next to it --
  // what proves it shares the left cell, rather than sitting in a single
  // full-width stacked column, is that its whole box stays left of where the
  // right column starts.
  expect(secondBox.x).toBeGreaterThanOrEqual(firstBox.x - 1);
  expect(secondBox.x + secondBox.width).toBeLessThanOrEqual(rightBox.x);
});

/** Walk past the card routine to the borderless one that follows it. */
async function enterBorderlessRoutine(
  page: import("@playwright/test").Page,
): Promise<void> {
  await enterExperiment(page);
  await page.getByRole("button", { name: "Advance the layout bench" }).click();
  await expect(page.getByText("Borderless column one")).toBeVisible();
}

test("a borderless 6:6 row renders as two columns", async ({ page }) => {
  await enterBorderlessRoutine(page);

  const left = page.getByText("Borderless column one");
  const right = page.getByText("Borderless column two");

  const leftBox = await left.boundingBox();
  const rightBox = await right.boundingBox();
  if (!leftBox || !rightBox) throw new Error("Both columns must be laid out");

  expect(rightBox.x).toBeGreaterThan(leftBox.x + leftBox.width - 1);
  expect(Math.abs(leftBox.y - rightBox.y)).toBeLessThan(8);
});

test("a borderless routine centres its elements, positioned or not", async ({ page }) => {
  await enterBorderlessRoutine(page);

  const viewport = page.viewportSize();
  if (!viewport) throw new Error("The test needs a sized viewport");
  const pageCentre = viewport.width / 2;

  const loose = page.getByText("Borderless with no position");
  await expect(loose).toBeVisible();

  const looseBox = await loose.boundingBox();
  const leftBox = await page.getByText("Borderless column one").boundingBox();
  if (!looseBox || !leftBox) throw new Error("Both elements must be laid out");

  // Centring is what makes each box shrink to its content: stretched, the
  // positionless element would span the whole container and the left column
  // element would span its whole half. Both would then be "centred" by
  // accident, so the width bound is the half of this that actually discriminates.
  expect(looseBox.width).toBeLessThan(viewport.width / 2);
  expect(leftBox.width).toBeLessThan(viewport.width / 4);

  // The positionless element has no cell, so it centres against the page.
  expect(Math.abs(looseBox.x + looseBox.width / 2 - pageCentre)).toBeLessThan(8);

  // The positioned one centres against its own half.
  expect(Math.abs(leftBox.x + leftBox.width / 2 - pageCentre / 2)).toBeLessThan(12);
});
