import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import {
  seedTestExperiment,
  deleteTestExperiment,
  seedFinishModeExperiment,
  deleteFinishModeExperiment,
  ParticipantIdParam,
  disconnect,
} from "./fixtures/seed";

const prisma = new PrismaClient();

async function findParticipantForExperiment(experimentId: string) {
  return prisma.participant.findFirst({ where: { experimentId } });
}

async function findParticipantByExternalId(experimentId: string, externalId: string) {
  return prisma.participant.findFirst({ where: { experimentId, externalId } });
}

async function markCompleted(experimentId: string, externalId: string) {
  await prisma.participant.updateMany({
    where: { experimentId, externalId },
    data: { completion: true },
  });
}

/** Any same-origin page works as a redirect target; the login page is stable. */
const RedirectTarget = "http://localhost:5199/admin/login";

test.afterAll(async () => {
  await deleteFinishModeExperiment();
  await deleteTestExperiment();
  await disconnect();
  await prisma.$disconnect();
});

/** Walk a finish-mode experiment from the lobby to its end routine. */
async function reachEnd(page: Page, experimentId: string) {
  await page.goto(`/experiment/${experimentId}`);
  await page.getByRole("button", { name: "Begin Experiment" }).click();
  await page.getByRole("button", { name: "I'm Ready" }).click();
  await expect(page.getByText("Finish mode trial")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
}

test.describe("finish behaviour", () => {
  test("debrief mode shows the debrief and completes without redirecting", async ({
    page,
  }) => {
    const id = await seedFinishModeExperiment("debrief", RedirectTarget);
    await reachEnd(page, id);

    await expect(page.getByText("Debrief text")).toBeVisible();
    await page.getByRole("button", { name: "Finish" }).click();

    await expect(page.getByText("Thank You")).toBeVisible();
    expect(new URL(page.url()).pathname).toContain("/experiment/");
  });

  test("debrief-redirect shows the debrief, then redirects on confirmation", async ({
    page,
  }) => {
    const id = await seedFinishModeExperiment("debrief-redirect", RedirectTarget);
    await reachEnd(page, id);

    // The debrief is still shown; the button reads as a hand-off.
    await expect(page.getByText("Debrief text")).toBeVisible();
    await expect(page.getByRole("button", { name: "Finish" })).toHaveCount(0);
    await page.getByRole("button", { name: "Continue" }).click();

    await page.waitForURL(RedirectTarget, { timeout: 15_000 });
  });

  test("redirect-only leaves immediately without showing a debrief", async ({
    page,
  }) => {
    const id = await seedFinishModeExperiment("redirect-only", RedirectTarget);
    await reachEnd(page, id);

    await page.waitForURL(RedirectTarget, { timeout: 15_000 });
    await expect(page.getByText("Debrief text")).toHaveCount(0);
  });

  test("redirect-only still records completion before leaving", async ({ page }) => {
    const id = await seedFinishModeExperiment("redirect-only", RedirectTarget);
    await reachEnd(page, id);
    await page.waitForURL(RedirectTarget, { timeout: 15_000 });

    const participant = await findParticipantForExperiment(id);
    expect(participant?.completion).toBe(true);
  });
});

test.describe("participant id capture", () => {
  let experimentId: string;

  test.beforeAll(async () => {
    experimentId = await seedTestExperiment();
  });

  async function join(page: Page, query: string) {
    await page.goto(`/experiment/${experimentId}${query}`);
    await page.getByRole("button", { name: "Begin Experiment" }).click();
    await page.getByRole("button", { name: "I'm Ready" }).click();
  }

  test("records the id from the configured URL parameter", async ({ page }) => {
    await join(page, `?${ParticipantIdParam}=pid-alpha`);
    await expect(page.getByText("Keyboard trial")).toBeVisible();

    const participant = await findParticipantByExternalId(experimentId, "pid-alpha");
    expect(participant).not.toBeNull();
  });

  test("resumes the same participant when the id returns", async ({ page, browser }) => {
    await join(page, `?${ParticipantIdParam}=pid-beta`);
    await expect(page.getByText("Keyboard trial")).toBeVisible();
    await page.keyboard.press("f");
    await expect(page.getByText("Choose your answers")).toBeVisible();

    // A different browser context has no localStorage, so only the URL id can
    // identify them.
    const fresh = await browser.newContext();
    const secondPage = await fresh.newPage();
    await secondPage.goto(`/experiment/${experimentId}?${ParticipantIdParam}=pid-beta`);
    await secondPage.getByRole("button", { name: "Begin Experiment" }).click();
    await secondPage.getByRole("button", { name: "I'm Ready" }).click();

    // Resumed at the routine they had reached, not back at the start.
    await expect(secondPage.getByText("Choose your answers")).toBeVisible();
    await fresh.close();
  });

  test("refuses an id that has already completed the experiment", async ({
    page,
    browser,
  }) => {
    await join(page, `?${ParticipantIdParam}=pid-gamma`);
    await expect(page.getByText("Keyboard trial")).toBeVisible();
    await markCompleted(experimentId, "pid-gamma");

    const fresh = await browser.newContext();
    const secondPage = await fresh.newPage();
    await secondPage.goto(`/experiment/${experimentId}?${ParticipantIdParam}=pid-gamma`);
    await secondPage.getByRole("button", { name: "Begin Experiment" }).click();

    await expect(secondPage.getByText(/already taken part/i)).toBeVisible();
    await fresh.close();
  });

  test("still admits participants who arrive without the parameter", async ({
    page,
  }) => {
    await join(page, "");
    await expect(page.getByText("Keyboard trial")).toBeVisible();
  });
});
