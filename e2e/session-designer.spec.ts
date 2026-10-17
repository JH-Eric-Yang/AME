import { test, expect, type Page } from "@playwright/test";
import type { RoutineConfig } from "ame-shared";
import {
  seedSessionDesignerExperiment,
  deleteSessionDesignerExperiment,
  findContentRows,
  deleteBlockContentRows,
  findExperimentRow,
  disconnect,
  DesignerAdminEmail,
  DesignerAdminPassword,
  SessionDesignerExperimentName,
  TrialRoutineName,
  IntroRoutineName,
} from "./fixtures/seed";

/**
 * The Session Designer, end to end.
 *
 * The client suite has no jsdom, so SessionDesignerTab, CohortPanel,
 * RotationSchedule, CoverageMatrix, ApplyBar and DriftStrip are never mounted
 * by a unit test. This spec is the only thing that executes them.
 *
 * It also proves the plan's central claim: the seven columns the schedule
 * renders and the seven trial rows the database receives come out of ONE
 * compile step, so a change to either shows up in both.
 *
 * Out of scope, deliberately: camera-driven elements (Chromium's fake webcam
 * carries no face, so MediaPipe never fires) and multi-participant runtime
 * rotation (that needs eight simultaneous participants, and is covered by
 * server/src/__tests__/rotationSession.test.ts). This is authoring only.
 */

/** The canonical study: eight participants, dyads, seven trials. */
const CohortSize = 8;
const Trials = CohortSize - 1;
const GroupSize = 2;

/** Every unordered pair of an eight-seat cohort: 8 × 7 / 2. */
const TotalPairs = (CohortSize * (CohortSize - 1)) / 2;

/** A cohort size that no group of two divides — the blocking case. */
const IndivisibleCohortSize = 7;

/**
 * Nine seats in triads: the groups divide evenly, but no rotation of them makes
 * every pair meet. The validator files that under `pattern`, so it is the one
 * case that proves the Pattern select renders its own field's issues.
 */
const UncoverableCohortSize = 9;
const UncoverableGroupSize = 3;

const MatchRoutineName = `${TrialRoutineName}-match`;
const EndMatchRoutineName = `${TrialRoutineName}-end-match`;

/** The block starts at progress 1: the bench seeds one row at progress 0. */
const BlockStartProgress = 1;

let experimentId: string;

test.beforeAll(async () => {
  experimentId = await seedSessionDesignerExperiment();
});

test.afterAll(async () => {
  await deleteSessionDesignerExperiment();
  await disconnect();
});

/** Sign in as the bench experimenter and land on the dashboard. */
async function signIn(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(DesignerAdminEmail);
  await page.getByLabel("Password").fill(DesignerAdminPassword);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL("**/admin/dashboard");
}

/** Sign in, open the bench experiment, and switch to the Session tab. */
async function openSessionTab(page: Page): Promise<void> {
  await signIn(page);
  await page.goto(`/admin/dashboard/experiment/${experimentId}`);
  await expect(
    page.getByRole("heading", { name: SessionDesignerExperimentName }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Session", exact: true }).click();
}

/** Press the empty state's primary button and wait for the designer to appear. */
async function createBlock(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New session block", exact: true }).click();
  await expect(page.getByRole("button", { name: "Generate & Save" })).toBeVisible();
}

/**
 * Serial: test 6 reads the state test 5 persisted, and tests 1–4 rely on the
 * experiment still having no saved session block. `workers: 1` and
 * `fullyParallel: false` are already set in playwright.config.ts; `.serial`
 * additionally skips the rest of the file once one test fails, so a cascade
 * cannot disguise which step actually broke.
 */
test.describe.serial("session designer", () => {
  test("offers an empty state before any block exists", async ({ page }) => {
    await openSessionTab(page);

    await expect(page.getByText("No session block yet")).toBeVisible();
    await expect(
      page.getByText("Pre-filled for 8 participants in dyads over 7 trials."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "New session block", exact: true }),
    ).toBeVisible();

    // Nothing is generated until Generate & Save is pressed.
    await expect(page.getByRole("button", { name: "Generate & Save" })).toHaveCount(0);
  });

  test("renders seven trials for the pre-filled cohort, at the progresses they will run at", async ({
    page,
  }) => {
    await openSessionTab(page);
    await createBlock(page);

    const schedule = page.locator(".schedule-table");

    // One header for the seat column plus one per trial.
    await expect(schedule.locator("thead th")).toHaveCount(Trials + 1);
    await expect(schedule.locator("tbody tr")).toHaveCount(CohortSize);

    // The progress each trial will occupy. These are the numbers the compiler
    // will write into ExperimentContent.progress, read straight off the screen.
    await expect(schedule.locator(".progress-label")).toHaveText(
      Array.from({ length: Trials }, (_, index) => `p${BlockStartProgress + 1 + index}`),
    );

    // Seat 1 meets each of the other seven seats exactly once across the seven
    // trials — the circle-method rotation, visible rather than asserted.
    await expect(schedule.locator("tbody tr").first().locator("td.partner")).toHaveText([
      "8",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
    ]);
  });

  test("shows a complete coverage matrix with no repeats and no strangers", async ({
    page,
  }) => {
    await openSessionTab(page);
    await createBlock(page);

    await page.getByRole("button", { name: "Coverage" }).click();

    await expect(page.getByText(`${TotalPairs} of ${TotalPairs} pairs covered`)).toBeVisible();
    await expect(page.getByText("0 repeats")).toBeVisible();
    await expect(page.getByText("0 never meet")).toBeVisible();
  });

  test("blocks Generate & Save on an indivisible cohort and re-enables it when fixed", async ({
    page,
  }) => {
    await openSessionTab(page);
    await createBlock(page);

    const applyBar = page.locator(".apply-bar");
    const applyButton = applyBar.getByRole("button", { name: "Generate & Save" });
    const cohortInput = page.getByLabel("Cohort size");

    await expect(applyButton).toBeEnabled();

    // A cohort of seven cannot be split into dyads.
    await cohortInput.fill(String(IndivisibleCohortSize));
    await cohortInput.blur();

    await expect(applyButton).toBeDisabled();

    // The failure sits on the button's own row, as the mockup shows...
    await expect(
      applyBar.getByText(
        `A cohort of ${IndivisibleCohortSize} cannot be split into groups of ${GroupSize}.`,
      ),
    ).toBeVisible();

    // ...and again beside the control that caused it, because the rule is
    // filed under the "cohortSize" field rather than under "pattern".
    await expect(page.locator(".cohort-panel .config-hint.error").first()).toContainText(
      `A cohort of ${IndivisibleCohortSize} cannot be split into groups of ${GroupSize}.`,
    );

    await cohortInput.fill(String(CohortSize));
    await cohortInput.blur();

    await expect(applyButton).toBeEnabled();
    await expect(page.locator(".cohort-panel .config-hint.error")).toHaveCount(0);
  });

  test("Generate & Save writes the block's routines and its content rows together", async ({
    page,
  }) => {
    await openSessionTab(page);
    await createBlock(page);

    // What the bar promises before the write: the band it will own.
    const applyBar = page.locator(".apply-bar");
    await expect(applyBar).toContainText(
      new RegExp(
        `${Trials + 2} content rows, progress ${BlockStartProgress}.${BlockStartProgress + Trials + 1}, condition Basic`,
      ),
    );

    await applyBar.getByRole("button", { name: "Generate & Save" }).click();

    await expect(page.getByText(`Applied · ${Trials + 2} rows written`)).toBeVisible();

    // ── The routines ───────────────────────────────────
    const saved = await findExperimentRow(experimentId);
    expect(saved).not.toBeNull();

    const routines = saved!.routines as unknown as RoutineConfig[];
    const byName = new Map(routines.map((routine) => [routine.name, routine]));

    expect([...byName.keys()].sort()).toEqual(
      [IntroRoutineName, TrialRoutineName, MatchRoutineName, EndMatchRoutineName].sort(),
    );

    expect(byName.get(MatchRoutineName)?.type).toBe("routine-matching");
    expect(byName.get(MatchRoutineName)?.matching?.slots).toHaveLength(CohortSize);
    expect(byName.get(MatchRoutineName)?.matching?.strategy).toBe("fifo");

    // The trial routine must NOT carry matching of its own: a trial routine
    // that re-matches destroys the session and pins every trial to rotation 0.
    expect(byName.get(TrialRoutineName)?.type).toBe("routine-video-chat");
    expect(byName.get(TrialRoutineName)?.matching ?? null).toBeNull();
    expect(byName.get(TrialRoutineName)?.interactionPattern).toEqual({
      type: "round-robin",
      groupSize: GroupSize,
    });

    expect(byName.get(EndMatchRoutineName)?.type).toBe("routine-end-matching");

    // Participants Per Session follows the cohort.
    expect(saved!.participantsPerSession).toBe(CohortSize);

    // ── The content rows ───────────────────────────────
    // This is the assertion the whole plan exists for: the seven columns the
    // schedule rendered above and these seven trial rows are emitted by one
    // compile step, so they cannot disagree.
    const expectedBlockRows: [number, string, number][] = [
      [BlockStartProgress, MatchRoutineName, 1],
      ...Array.from(
        { length: Trials },
        (_, index) =>
          [BlockStartProgress + 1 + index, TrialRoutineName, index + 1] as [
            number,
            string,
            number,
          ],
      ),
      [BlockStartProgress + Trials + 1, EndMatchRoutineName, 1],
    ];

    const rows = await findContentRows(experimentId);
    expect(rows.map((row) => [row.progress, row.routine, row.trialNumber])).toEqual([
      // The pre-existing row at progress 0 sits outside the band and survives.
      [0, IntroRoutineName, 1],
      ...expectedBlockRows,
    ]);

    const blockRows = rows.filter((row) => row.progress >= BlockStartProgress);
    expect(blockRows.every((row) => row.condition === "Basic")).toBe(true);
    expect(blockRows.every((row) => row.description?.startsWith("block:"))).toBe(true);
  });

  /**
   * Depends on the previous test having applied the block: it reads back what
   * Generate & Save persisted. `.serial` guarantees the ordering and skips this
   * one if the apply failed.
   */
  test("re-opening the tab straight after an apply shows no drift", async ({ page }) => {
    await openSessionTab(page);

    // The design itself round-tripped through Experiment.sessionDesigns. This
    // assertion comes first because it auto-waits for the designer to mount;
    // the negatives below would otherwise pass against an unrendered tab.
    await expect(page.getByRole("option", { name: `${TrialRoutineName} block` })).toHaveCount(
      1,
    );
    await expect(page.getByText("No session block yet")).toHaveCount(0);

    // ...and recompiling it reproduces exactly the routines the Builder now
    // holds, so the design and the Builder have nothing to argue about.
    await expect(page.getByText(/Builder edits detected/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Adopt from Builder" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Overwrite from Design" })).toHaveCount(0);
  });


  /**
   * The failure paths of Generate & Save, and the panel state that outlives them.
   *
   * Nested inside the parent describe, and therefore ordered after it: every
   * test here needs the block the Generate & Save test applied.
   *
   * These run after the block has been applied, and they deliberately fail the
   * CONTENT upload rather than the routines write: that is the half-write the
   * feature has to be honest about, and it is the one a researcher can be left
   * sitting in. The content PUT is intercepted; the routines PUT is left alone,
   * so the server really does end up holding routines whose rows are missing.
   */
  test.describe.serial("session designer failure paths", () => {
    /** The body a routed content upload rejects with; unique, for strict mode. */
    const UploadFailureMessage = "E2E injected content-upload failure";

    /** Matches the content route on any origin — the API is served from another port. */
    const ContentRoute = "**/api/admin/experiments/*/content";

    /** The Session tab's own header, so a reload can wait for the page to be back. */
    const ContentUploadFailedSummary = "Routines saved — content upload failed.";

    /**
     * Fail every content PUT with `UploadFailureMessage`. GETs are left alone —
     * the tab lists the content rows on mount, and swallowing that would change
     * what is being tested. `hold` gates the response so a test can act while the
     * write is genuinely in flight, which is what makes the C1 race deterministic
     * rather than a sleep.
     */
    async function failContentUpload(page: Page, hold?: Promise<void>): Promise<void> {
      await page.route(ContentRoute, async (route) => {
        if (route.request().method() !== "PUT") {
          await route.continue();
          return;
        }

        if (hold) await hold;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ code: "E2E_FAIL", message: UploadFailureMessage }),
        });
      });
    }

    test("an edit made while a write is in flight cannot start a second one", async ({ page }) => {
      await openSessionTab(page);

      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await failContentUpload(page, held);

      const applyBar = page.locator(".apply-bar");
      // By position, not by name: the label changes to "Saving…" mid-write.
      const applyButton = applyBar.locator("button");

      await applyButton.click();
      await expect(applyButton).toBeDisabled();

      // The edit resets the apply state to "idle". Without the in-flight guard
      // that re-enables the button, and a second press would put two content
      // PUTs with different replace bands in the air at once.
      const startProgress = page.getByLabel("Start at progress");
      await startProgress.fill("2");
      await startProgress.blur();

      await expect(applyBar).toContainText("content rows, progress 2");
      await expect(applyButton).toBeDisabled();

      release();

      // And the write that was already running still reports what it did, even
      // though its outcome no longer describes the design on screen.
      await expect(page.locator(".apply-error")).toHaveText(UploadFailureMessage);
    });

    test("a failure message does not outlive the next edit", async ({ page }) => {
      await openSessionTab(page);
      await failContentUpload(page);

      const applyBar = page.locator(".apply-bar");
      await applyBar.locator("button").click();

      await expect(applyBar).toContainText(ContentUploadFailedSummary);
      await expect(page.locator(".apply-error")).toHaveText(UploadFailureMessage);

      const startProgress = page.getByLabel("Start at progress");
      await startProgress.fill("3");
      await startProgress.blur();

      // The bar is back to a plan for the edited design...
      await expect(applyBar).toContainText("content rows, progress 3");
      // ...so the red line under it belongs to a write nobody is looking at now.
      await expect(page.locator(".apply-error")).toHaveCount(0);
    });

    test("a cleared Cohort size field snaps back to the number the block kept", async ({
      page,
    }) => {
      await openSessionTab(page);

      const cohortInput = page.getByLabel("Cohort size");
      await cohortInput.fill("");
      await cohortInput.blur();

      // The design refused the empty field, so the field must not keep showing it:
      // the apply bar is about to promise this number to the server.
      await expect(cohortInput).toHaveValue(String(CohortSize));
      await expect(page.locator(".apply-bar")).toContainText(
        `sets Participants Per Session to ${CohortSize}`,
      );
    });

    test("switching blocks shows the incoming block's own controls", async ({ page }) => {
      await openSessionTab(page);

      const pin = page.getByRole("checkbox", { name: "full round-robin" });
      // Exact: "Between trials" would otherwise match a substring search for "Trials".
      const trialsInput = page.getByRole("spinbutton", { name: "Trials", exact: true });

      await pin.uncheck();
      await expect(trialsInput).toBeEnabled();

      // A brand-new block IS a full round-robin. Its pane must say so, rather
      // than inheriting the tick the previous block's editor had lapsed.
      await page.getByRole("button", { name: "+ New session block" }).click();

      await expect(pin).toBeChecked();
      await expect(trialsInput).toBeDisabled();
    });

    /**
     * The validator's newest blocking rule files itself under `pattern`, not
     * under `cohortSize`. Nothing else in the suite renders a `pattern` issue,
     * so if the Pattern select ever stopped binding that field the error would
     * be invisible and a researcher would first meet it as a 400 on Save.
     */
    test("shows a round-robin that does not cover its cohort under the Pattern select", async ({
      page,
    }) => {
      await openSessionTab(page);

      const applyButton = page.locator(".apply-bar button");
      const cohortInput = page.getByLabel("Cohort size");
      const patternField = page.locator(".field-row").first().locator(".field").first();

      // Nine seats in triads divide evenly, so nothing here is arithmetic —
      // the rule builds the schedule and measures which pairs actually meet.
      await cohortInput.fill(String(UncoverableCohortSize));
      await cohortInput.blur();
      await page
        .getByLabel("Group size")
        .selectOption(String(UncoverableGroupSize));

      await expect(patternField.locator(".issue")).toContainText(
        `A round-robin in groups of ${UncoverableGroupSize} does not cover a cohort of ${UncoverableCohortSize}.`,
      );
      await expect(applyButton).toBeDisabled();
    });

    /**
     * Runs last: it removes the block's content rows, which every earlier test
     * in the file relies on being there.
     */
    test("a block whose rows are missing re-opens on Retry upload", async ({ page }) => {
      const deleted = await deleteBlockContentRows(experimentId);
      expect(deleted).toBe(Trials + 2);

      await openSessionTab(page);

      const applyBar = page.locator(".apply-bar");
      // Read off the server, not remembered: the routines are saved and drift-free,
      // and no content row carries this block's id, so the only honest offer is a
      // retry of the upload.
      await expect(applyBar).toContainText(ContentUploadFailedSummary);
      await expect(applyBar.getByRole("button", { name: "Retry upload" })).toBeVisible();
    });
  });
});
