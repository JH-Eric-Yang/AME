import { test, expect, type Page } from "@playwright/test";
import { getParamInfo } from "ame-shared/parameterHelp";
import { findResults } from "../fixtures/seed";
import { createTutorialBench, EndText, TrialRoutine } from "./kit/bench";
import {
  dropElement,
  openBuilder,
  openResults,
  participantLink,
  saveChanges,
  selectElement,
  signIn,
  startAsParticipant,
} from "./kit/builder";
import { TutorialSession } from "./kit/session";
import { PaletteLabels, type ParamRow } from "./kit/types";
import { Tutorials, type TutorialDefinition } from "./definitions";

/**
 * One recorded tutorial for each definition: build the element in the
 * Builder, use it as a participant, and find the data on the Results tab.
 * Each step asserts its result, so a tutorial is also an e2e test.
 */

test.describe.configure({ mode: "default" });

/** Time limit for one tutorial: the pauses for the viewer make it slow. */
const TutorialTimeoutMs = 180_000;

function paramRows(def: TutorialDefinition): ParamRow[] {
  return (def.params ?? []).map(({ key, value }) => {
    const info = getParamInfo(def.type, key);
    return {
      key,
      label: key,
      help: info?.description ?? "",
      defaultValue: info?.default ?? "–",
      value,
    };
  });
}

async function storedResponse(experimentId: string, responseId: string): Promise<Record<string, unknown> | undefined> {
  const rows = await findResults(experimentId, responseId);
  return rows.find((row) => row.routine === TrialRoutine)?.response as Record<string, unknown> | undefined;
}

for (const def of Tutorials) {
  test(`tutorial: ${PaletteLabels[def.type]}`, async ({ browser, baseURL }) => {
    test.setTimeout(TutorialTimeoutMs);
    let stored: Record<string, unknown> | undefined;
    let error: string | null = null;
    const label = PaletteLabels[def.type];
    let t: TutorialSession | null = null;

    try {
      const experimentId = await createTutorialBench(label, def.question);
      t = await TutorialSession.start(browser, def.type, baseURL!);
      const page: Page = t.page;
      await def.prepare?.(page);

      await t.step("Build", "Sign in. Open the experiment, and select the routine trial.", async () => {
        await signIn(page);
        await openBuilder(page, experimentId);
      }, { detail: "The Builder tab opens first. The left panel lists the routines." });

      let name = "";
      await t.step("Build", `Drag ${label} from the palette into the empty row.`, async () => {
        name = await dropElement(page, def.type);
      }, { detail: `${label} is in the ${def.paletteGroup} group of the palette. The Builder names the new element ${def.type}-3.` });

      await t.step("Build", `Click ${def.type}-3. The Inspector shows its fields.`, async () => {
        await selectElement(page, name);
      });

      await def.build(t!, name);

      await t.step("Build", "Click Save Changes.", async () => {
        await saveChanges(page);
      }, { detail: "Participants get the saved version only." });

      let responseId = "";
      await t.step("Run", "Open the participant link. Click Begin Experiment, then I'm Ready.", async () => {
        const link = await participantLink(page);
        responseId = await startAsParticipant(page, link, experimentId);
        const question = page.getByText(def.question, { exact: true });
        // An element that proceeds by itself (a volume check on a loud
        // microphone) can end the routine before this check runs.
        await expect(def.autoProceeds ? question.or(page.getByText(EndText)) : question).toBeVisible();
      }, { detail: "Here the link opens in the same window. A participant gets the link from you, for example on Prolific." });

      await def.run(t!);

      if (!def.autoProceeds) {
        await t.step("Run", "Click Next.", async () => {
          await page.getByRole("button", { name: "Next" }).click();
          await expect(page.getByText(EndText)).toBeVisible();
        }, { detail: "The Next button sends the routine's data to the server." });
      } else {
        await expect(page.getByText(EndText)).toBeVisible({ timeout: 15_000 });
      }

      await t.step("Results", "Open the Results tab. Find the row for trial.", async () => {
        await expect.poll(() => storedResponse(experimentId, responseId)).toBeDefined();
        const row = await openResults(page, experimentId);
        stored = await storedResponse(experimentId, responseId);
        def.expectStored(stored!, name);
        if (def.resultText) await expect(row).toContainText(def.resultText(name));
      }, { detail: def.resultDetail });
    } catch (e) {
      error = e instanceof Error ? e.message.split("\n").slice(0, 6).join("\n") : String(e);
    } finally {
      // Always close the recording page and write what the run has. Without a
      // manifest the index shows the element as failed with "no result".
      await t?.finish(
        {
          summary: def.summary,
          params: paramRows(def),
          checks: def.checks,
          stored: stored ?? null,
          defects: def.defects ?? [],
          notes: def.notes ?? [],
        },
        error === null,
        error,
      );
    }
    expect(error, `the ${label} tutorial failed`).toBeNull();
  });
}
