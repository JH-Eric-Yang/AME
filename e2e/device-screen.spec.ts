import { test, expect, type Page } from "@playwright/test";
import {
  seedDeviceScreenExperiment,
  deleteDeviceScreenExperiment,
  findParticipant,
  disconnect,
} from "./fixtures/seed";

let experimentId: string;

test.beforeAll(async () => {
  experimentId = await seedDeviceScreenExperiment();
});

test.afterAll(async () => {
  await deleteDeviceScreenExperiment();
  await disconnect();
});

/**
 * Walk the desktop from the lobby into device-trial, the first of the
 * bench's two device-bearing routines.
 *
 * This is a LOCAL helper, not `elements/response.spec.ts`'s `startExperiment`: that
 * function is not exported, hard-waits on "Keyboard trial", and walks a
 * different experiment entirely — so it is left untouched here.
 *
 * @returns the participantId the device URL needs (resolved through the
 *          responseId the client stashes in localStorage) and that
 *          responseId itself.
 */
async function startExperiment(
  page: Page,
): Promise<{ participantId: string; responseId: string }> {
  await page.goto(`/experiment/${experimentId}`);
  await page.getByRole("button", { name: "Begin Experiment" }).click();
  await page.getByRole("button", { name: "I'm Ready" }).click();
  await expect(page.getByText("Desk copy for the device trial", { exact: true })).toBeVisible();

  const responseId = await page.evaluate(
    (id) => localStorage.getItem(`ame-responseId-${id}`),
    experimentId,
  );
  expect(responseId).toBeTruthy();

  const participant = await findParticipant(experimentId, responseId!);
  expect(participant).toBeTruthy();

  return { participantId: participant!.id, responseId: responseId! };
}

test.describe("supplementary device screen", () => {
  test("shows the phone its own elements and lets it advance the desktop", async ({
    browser,
  }) => {
    const desktop = await browser.newContext();
    const desktopPage = await desktop.newPage();
    const { participantId } = await startExperiment(desktopPage);

    // The desktop has its own copy and NOT the phone's.
    await expect(desktopPage.getByText("Desk copy for the device trial", { exact: true })).toBeVisible();
    await expect(desktopPage.getByText("Phone copy for the device trial", { exact: true })).toHaveCount(0);

    // The phone pairs mid-routine, which is the normal case: it navigates to
    // the device URL only after the desktop is already on the routine, which
    // exercises the catch-up path (`sendDeviceContent`) rather than the
    // initial delivery (`deliverContent`'s own emit).
    const phone = await browser.newContext();
    const phonePage = await phone.newPage();
    await phonePage.goto(`/device/${experimentId}/${participantId}?mode=controller`);

    await expect(phonePage.getByText("Phone copy for the device trial", { exact: true })).toBeVisible();
    await expect(phonePage.getByText("Desk copy for the device trial", { exact: true })).toHaveCount(0);

    // A press on the phone advances the desktop, which owns the state: the
    // phone only ever reports intent, never records anything itself.
    await phonePage.getByRole("button", { name: "Send from phone" }).click();
    await expect(desktopPage.getByText("Desk copy for the device trial", { exact: true })).toHaveCount(0);
    await expect(
      desktopPage.getByText("Second desk copy for the device trial", { exact: true }),
    ).toBeVisible();

    // The phone never reconnected — it is still the same socket paired for
    // device-trial. Only `deliverContent`'s own `device:content` emit (fired
    // when the desktop advances into a new routine) can have updated it, so
    // asserting the SECOND routine's phone copy is now visible — a positive
    // assertion a blank or crashed phone page cannot satisfy — is the proof
    // that emit works, distinct from the catch-up path proven above.
    await expect(
      phonePage.getByText("Second phone copy for the device trial", { exact: true }),
    ).toBeVisible();
    await expect(phonePage.getByText("Phone copy for the device trial", { exact: true })).toHaveCount(0);

    // A second press confirms the desktop keeps applying the still-paired
    // phone's intents through to the end of the routine sequence.
    await phonePage.getByRole("button", { name: "Send again from phone" }).click();
    await expect(
      desktopPage.getByText("Second desk copy for the device trial", { exact: true }),
    ).toHaveCount(0);
    await expect(desktopPage.getByText("Device screen run complete", { exact: true })).toBeVisible();

    await desktop.close();
    await phone.close();
  });
});
