/**
 * Seeds a disposable experiment exercising the elements added in Phase 13.
 *
 * Each routine isolates one element so a failure points at a single component.
 * The facial-expression detector is deliberately absent: Chromium's fake webcam
 * carries no face, so MediaPipe can never fire its trigger.
 */

import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import type { ElementConfig, FreePlacement, RoutineConfig } from "ame-shared";
import { unlinkAssetFile } from "../../server/src/assets/storage.js";
import { GeneratedDescriptionPrefix } from "ame-shared/contentValidation";
import { compileSessionDesign, type SessionDesign } from "ame-shared/sessionDesign";
import { prisma } from "./db";


export const TestExperimentName = "E2E — Phase 13 Elements";
export const ParticipantIdParam = "PROLIFIC_PID";
const RedirectExperimentName = "E2E — Finish Modes";

function card(name: string, elements: ElementConfig[]): RoutineConfig {
  return {
    name,
    type: "routine-card",
    layout: { rows: [{ columns: [{ span: 12 }] }] },
    elements,
  };
}

function nextButton(name = "next"): ElementConfig {
  return {
    name,
    type: "button",
    params: { label: "Next" },
    events: [{ trigger: "click", type: "proceed" }],
  };
}

const routines: RoutineConfig[] = [
  card("keyboard-trial", [
    { name: "prompt", type: "text", params: { content: "Keyboard trial" } },
    {
      name: "response",
      type: "keyboard",
      params: { keys: ["f", "j"], recordMode: "first", hint: "Press F or J" },
      events: [{ trigger: "press", type: "proceed" }],
    },
  ]),

  card("options-trial", [
    { name: "prompt", type: "text", params: { content: "Choose your answers" } },
    {
      name: "colour",
      type: "input-option-group",
      params: {
        optionType: "radio",
        options: [
          { value: "red", label: "Red" },
          { value: "blue", label: "Blue" },
        ],
      },
    },
    {
      name: "fruits",
      type: "input-option-group",
      params: {
        optionType: "checkbox",
        options: [
          { value: "apple", label: "Apple" },
          { value: "pear", label: "Pear" },
        ],
      },
    },
    nextButton(),
  ]),

  card("file-trial", [
    { name: "prompt", type: "text", params: { content: "Upload a file" } },
    {
      name: "upload",
      type: "input-file-picker",
      params: { accept: ".txt", label: "Choose file", maxSizeMb: 5 },
    },
    nextButton(),
  ]),

  card("survey-trial", [
    {
      name: "questionnaire",
      type: "survey",
      params: {
        proceedOnComplete: true,
        submitLabel: "Submit",
        surveyJson: {
          elements: [
            { type: "text", name: "nickname", title: "What should we call you?" },
          ],
        },
      },
    },
  ]),

  card("alert-trial", [
    { name: "prompt", type: "text", params: { content: "Trigger an alert" } },
    {
      name: "alarm",
      type: "button",
      params: { label: "Raise alert" },
      events: [{ trigger: "click", type: "alert", params: { message: "Alert raised" } }],
    },
    nextButton(),
  ]),

  card("change-trial", [
    { name: "prompt", type: "text", params: { content: "Pick a language" } },
    {
      name: "language",
      type: "input-select",
      params: {
        options: [
          { value: "en", label: "English" },
          { value: "ja", label: "Japanese" },
        ],
      },
      events: [{ trigger: "change", type: "proceed" }],
    },
  ]),

  {
    name: "finish",
    type: "routine-end",
    layout: { rows: [{ columns: [{ span: 12 }] }] },
    elements: [{ name: "bye", type: "text", params: { content: "All done" } }],
  },
];

/** Remove any previous run's experiment, then create a fresh one. */
export async function seedTestExperiment(): Promise<string> {
  await prisma.experiment.deleteMany({ where: { name: TestExperimentName } });

  const experiment = await prisma.experiment.create({
    data: {
      name: TestExperimentName,
      description: "Automated end-to-end coverage. Safe to delete.",
      visible: true,
      allowNew: true,
      conditions: ["Basic"],
      participantsPerSession: 1,
      participantIdParam: ParticipantIdParam,
      routines: routines as unknown as object,
    },
  });

  await prisma.experimentContent.createMany({
    data: routines.map((routine, progress) => ({
      experimentId: experiment.id,
      progress,
      trialNumber: 1,
      routine: routine.name,
      condition: "Basic",
      content: {},
    })),
  });

  return experiment.id;
}

/**
 * A two-routine experiment whose end routine uses `finishMode`, for exercising
 * the redirecting finish behaviours without walking the full element bench.
 */
export async function seedFinishModeExperiment(
  finishMode: "debrief" | "debrief-redirect" | "redirect-only",
  redirectUrl: string,
): Promise<string> {
  await prisma.experiment.deleteMany({ where: { name: RedirectExperimentName } });

  const finishRoutines: RoutineConfig[] = [
    card("start", [
      { name: "prompt", type: "text", params: { content: "Finish mode trial" } },
      nextButton(),
    ]),
    {
      name: "finish",
      type: "routine-end",
      layout: { rows: [{ columns: [{ span: 12 }] }] },
      elements: [{ name: "bye", type: "text", params: { content: "Debrief text" } }],
      config: { finishMode, redirectUrl },
    },
  ];

  const experiment = await prisma.experiment.create({
    data: {
      name: RedirectExperimentName,
      description: "Automated end-to-end coverage. Safe to delete.",
      visible: true,
      allowNew: true,
      conditions: ["Basic"],
      participantsPerSession: 1,
      routines: finishRoutines as unknown as object,
    },
  });

  await prisma.experimentContent.createMany({
    data: finishRoutines.map((routine, progress) => ({
      experimentId: experiment.id,
      progress,
      trialNumber: 1,
      routine: routine.name,
      condition: "Basic",
      content: {},
    })),
  });

  return experiment.id;
}

export async function deleteFinishModeExperiment(): Promise<void> {
  await prisma.experiment.deleteMany({ where: { name: RedirectExperimentName } });
}

export async function deleteTestExperiment(): Promise<void> {
  await prisma.experiment.deleteMany({ where: { name: TestExperimentName } });
}

/** Results for one participant. Every test seeds its own, so scope by responseId. */
export async function findResults(experimentId: string, responseId: string) {
  return prisma.experimentResult.findMany({
    where: { experimentId, responseId },
    orderBy: { progress: "asc" },
  });
}

export async function findParticipant(experimentId: string, responseId: string) {
  return prisma.participant.findFirst({ where: { experimentId, responseId } });
}

/** Error groups for an experiment, newest event first within each group. */
export async function findErrorGroups(experimentId: string) {
  return prisma.errorGroup.findMany({
    where: { experimentId },
    include: { events: { orderBy: { occurredAt: "desc" } } },
  });
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}

// ── Session Designer bench ─────────────────────────────

/** Credentials the Session Designer spec signs in with. Seeded APPROVED: the
 *  login route refuses a PENDING account with ACCOUNT_PENDING.
 *
 *  The password is generated per run rather than fixed. `afterAll` deletes the
 *  account, and survives a failing test or a throwing `beforeAll` -- but not a
 *  killed worker, which would strand an APPROVED row until the next run's
 *  self-healing delete. Randomising means what it strands is not a usable login.
 *  The spec imports this binding from this module in the same worker process,
 *  so both sides see the same value. */
export const DesignerAdminEmail = "e2e-designer@ame.test";
export const DesignerAdminPassword = `e2e-designer-${randomUUID()}`;
const DesignerAdminName = "E2E Designer Admin";

/** Matches the cost factor used by the real signup route. */
const BcryptRounds = 10;

export const SessionDesignerExperimentName = "E2E — Session Designer";

/**
 * The video-chat routine the designer names its defaults after:
 * `defaultSessionDesign` picks the first `routine-video-chat` in the Builder,
 * so the block compiles Roundtable-match / Roundtable / Roundtable-end-match.
 * Deliberately not "Chat" — every assertion string in this suite has to be
 * unique or Playwright's strict mode trips.
 */
export const TrialRoutineName = "Roundtable";

/** A non-video routine that sits outside the block's progress band. */
export const IntroRoutineName = "Intro";

const designerRoutines: RoutineConfig[] = [
  card(IntroRoutineName, [
    { name: "welcome", type: "text", params: { content: "Session designer bench" } },
  ]),
  {
    name: TrialRoutineName,
    type: "routine-video-chat",
    layout: { rows: [{ columns: [{ span: 12 }] }] },
    elements: [],
  },
];

/**
 * An experiment owned by a signed-in-able experimenter, with one video-chat
 * routine and a single content row at progress 0.
 *
 * That row is load-bearing twice over: `lastProgressOf` reports 0 so the block
 * starts at progress 1 (making the whole band deterministic), and it sits
 * outside the band, so the Generate & Save assertion also proves the
 * transactional replace leaves rows it does not own alone.
 */
export async function seedSessionDesignerExperiment(): Promise<string> {
  await deleteSessionDesignerExperiment();

  const experimenter = await prisma.experimenter.create({
    data: {
      email: DesignerAdminEmail,
      password: await bcrypt.hash(DesignerAdminPassword, BcryptRounds),
      name: DesignerAdminName,
      role: "EXPERIMENTER",
      status: "APPROVED",
    },
  });

  const experiment = await prisma.experiment.create({
    data: {
      name: SessionDesignerExperimentName,
      description: "Automated end-to-end coverage. Safe to delete.",
      visible: false,
      allowNew: true,
      videoChat: true,
      conditions: ["Basic"],
      participantsPerSession: 1,
      routines: designerRoutines as unknown as object,
      experimenters: { create: { experimenterId: experimenter.id } },
    },
  });

  await prisma.experimentContent.create({
    data: {
      experimentId: experiment.id,
      progress: 0,
      trialNumber: 1,
      routine: IntroRoutineName,
      condition: "Basic",
      content: {},
    },
  });

  return experiment.id;
}

export async function deleteSessionDesignerExperiment(): Promise<void> {
  await prisma.experiment.deleteMany({ where: { name: SessionDesignerExperimentName } });
  await prisma.experimenter.deleteMany({ where: { email: DesignerAdminEmail } });
}

/** The saved experiment row — routines, sessionDesigns, participantsPerSession. */
export async function findExperimentRow(experimentId: string) {
  return prisma.experiment.findUnique({ where: { id: experimentId } });
}

/**
 * Every content row of an experiment, in the order the runner walks them.
 * The Session Designer bench seeds a fresh experiment per run, so unlike the
 * participant specs there is no need to scope by responseId here.
 */
export async function findContentRows(experimentId: string) {
  return prisma.experimentContent.findMany({
    where: { experimentId },
    orderBy: [{ progress: "asc" }, { trialNumber: "asc" }],
  });
}

/**
 * Delete only the rows a session block generated, leaving hand-authored rows
 * alone. Reproduces the state a failed content upload leaves behind — the
 * block's routines saved, its progress band empty — without having to fail a
 * real upload and then wait for the researcher to come back tomorrow.
 */
export async function deleteBlockContentRows(experimentId: string): Promise<number> {
  const { count } = await prisma.experimentContent.deleteMany({
    where: { experimentId, description: { startsWith: GeneratedDescriptionPrefix } },
  });
  return count;
}

// ── Media library bench ────────────────────────────────

export const MediaExperimentName = "E2E — Media Library";
export const MediaAdminEmail = "media-admin@e2e.test";
export const MediaAdminPassword = "media-admin-password";
export const MediaRoutineName = "media-trial";

/**
 * One routine holding one image element with NO source, so the spec can watch
 * it go from the Inspector's empty warning to a real stimulus.
 *
 * Both elements need a `position` — the admin canvas only renders elements
 * that match a grid cell, unlike the participant runner, which does not
 * filter by position at all.
 */
const mediaRoutines: RoutineConfig[] = [
  card(MediaRoutineName, [
    { name: "stim", type: "image", params: {}, position: { row: 0, column: 0, order: 0 } },
    { ...nextButton(), position: { row: 0, column: 0, order: 1 } },
  ]),
];

export async function seedMediaExperiment(): Promise<string> {
  await deleteMediaExperiment();

  const experimenter = await prisma.experimenter.create({
    data: {
      email: MediaAdminEmail,
      password: await bcrypt.hash(MediaAdminPassword, BcryptRounds),
      name: "Media Admin",
      role: "EXPERIMENTER",
      status: "APPROVED",
    },
  });

  const experiment = await prisma.experiment.create({
    data: {
      name: MediaExperimentName,
      description: "Automated end-to-end coverage. Safe to delete.",
      visible: true,
      allowNew: true,
      conditions: ["Basic"],
      participantsPerSession: 1,
      routines: mediaRoutines as unknown as object,
      experimenters: { create: { experimenterId: experimenter.id } },
    },
  });

  await prisma.experimentContent.create({
    data: {
      experimentId: experiment.id,
      progress: 0,
      trialNumber: 1,
      routine: MediaRoutineName,
      condition: "Basic",
      content: {},
    },
  });

  return experiment.id;
}

/**
 * Prisma's cascade drops the Asset ROWS when the experiment is deleted, but
 * rows are not files — mirrors `deleteExperiment` in admin.ts, which unlinks
 * each asset's bytes before the cascade. Both call the same `unlinkAssetFile`,
 * so the fixture cannot drift from production: a raw `deleteMany` alone would
 * orphan every file this spec uploads, plus tus's `<id>.json` sidecar next to
 * it, on every run.
 */
export async function deleteMediaExperiment(): Promise<void> {
  const experiment = await prisma.experiment.findFirst({
    where: { name: MediaExperimentName },
    select: { id: true },
  });

  if (experiment) {
    const assets = await prisma.asset.findMany({
      where: { experimentId: experiment.id },
      select: { filePath: true },
    });
    await Promise.all(
      assets
        .filter((asset) => asset.filePath)
        .map((asset) => unlinkAssetFile(asset.filePath!)),
    );
  }

  await prisma.experiment.deleteMany({ where: { name: MediaExperimentName } });
  await prisma.experimenter.deleteMany({ where: { email: MediaAdminEmail } });
}

// ── Text style bench ───────────────────────────────────

export const TextStyleExperimentName = "E2E — Text Style";
export const TextStyleAdminEmail = "text-style-admin@e2e.test";
export const TextStyleAdminPassword = "text-style-admin-password";
export const TextStyleRoutineName = "styled-trial";
/** Unique across the suite so strict mode never matches another element. */
export const StyledTextContent = "Styled headline for the typography bench";

/**
 * One routine with a text element whose every typography param is set, so
 * the participant assertion proves each one reaches the computed style, and
 * the builder assertion proves the Inspector reads them back and writes a
 * change through to the stored routine.
 */
const textStyleRoutines: RoutineConfig[] = [
  card(TextStyleRoutineName, [
    {
      name: "headline",
      type: "text",
      params: {
        content: StyledTextContent,
        fontSize: "32px",
        fontStyle: "italic",
        fontWeight: "600",
        color: "#ff0000",
        textAlign: "center",
        lineHeight: 2,
      },
      position: { row: 0, column: 0, order: 0 },
    },
    { ...nextButton(), position: { row: 0, column: 0, order: 1 } },
  ]),
];

export async function seedTextStyleExperiment(): Promise<string> {
  await deleteTextStyleExperiment();

  const experimenter = await prisma.experimenter.create({
    data: {
      email: TextStyleAdminEmail,
      password: await bcrypt.hash(TextStyleAdminPassword, BcryptRounds),
      name: "Text Style Admin",
      role: "EXPERIMENTER",
      status: "APPROVED",
    },
  });

  const experiment = await prisma.experiment.create({
    data: {
      name: TextStyleExperimentName,
      description: "Automated end-to-end coverage. Safe to delete.",
      visible: true,
      allowNew: true,
      conditions: ["Basic"],
      participantsPerSession: 1,
      routines: textStyleRoutines as unknown as object,
      experimenters: { create: { experimenterId: experimenter.id } },
    },
  });

  await prisma.experimentContent.create({
    data: {
      experimentId: experiment.id,
      progress: 0,
      trialNumber: 1,
      routine: TextStyleRoutineName,
      condition: "Basic",
      content: {},
    },
  });

  return experiment.id;
}

/** Nothing is uploaded by this bench, so the cascade alone is enough. */
export async function deleteTextStyleExperiment(): Promise<void> {
  await prisma.experiment.deleteMany({ where: { name: TextStyleExperimentName } });
  await prisma.experimenter.deleteMany({ where: { email: TextStyleAdminEmail } });
}

// ── Supplementary device screen bench ──────────────────

export const DeviceScreenExperimentName = "E2E — Device Screen";
export const DeviceTrialRoutineName = "device-trial";
export const DeviceTrialTwoRoutineName = "device-trial-two";

/**
 * A dedicated experiment rather than a routine appended to the Phase 13
 * bench's shared `routines` array: several of `elements/response.spec.ts`'s tests
 * assert "All done" is what follows `change-trial`'s auto-proceed, so
 * inserting a routine ahead of `finish` there breaks them even though the
 * earlier routines' progress numbers stay put. Two device-bearing routines
 * are enough to isolate the split-by-surface behaviour, so the participant
 * reaches the first immediately after the lobby.
 *
 * The second routine exists so an ALREADY-paired phone following the
 * participant into a new routine exercises `deliverContent`'s own
 * `device:content` emit, not just `sendDeviceContent`'s catch-up replay
 * that a phone pairing mid-routine relies on (see device-screen.spec.ts).
 */
const deviceScreenRoutines: RoutineConfig[] = [
  {
    ...card(DeviceTrialRoutineName, [
      { name: "deskPrompt", type: "text", params: { content: "Desk copy for the device trial" } },
      {
        name: "phonePrompt",
        type: "text",
        params: { content: "Phone copy for the device trial" },
        surface: "device",
      },
      {
        name: "phoneNext",
        type: "button",
        params: { label: "Send from phone" },
        surface: "device",
        events: [{ trigger: "click", type: "proceed" }],
      },
    ]),
    device: { mode: "controller" },
  },
  {
    ...card(DeviceTrialTwoRoutineName, [
      {
        name: "deskPromptTwo",
        type: "text",
        params: { content: "Second desk copy for the device trial" },
      },
      {
        name: "phonePromptTwo",
        type: "text",
        params: { content: "Second phone copy for the device trial" },
        surface: "device",
      },
      {
        name: "phoneNextTwo",
        type: "button",
        params: { label: "Send again from phone" },
        surface: "device",
        events: [{ trigger: "click", type: "proceed" }],
      },
    ]),
    device: { mode: "controller" },
  },
  {
    name: "finish",
    type: "routine-end",
    layout: { rows: [{ columns: [{ span: 12 }] }] },
    elements: [{ name: "bye", type: "text", params: { content: "Device screen run complete" } }],
  },
];

export async function seedDeviceScreenExperiment(): Promise<string> {
  await deleteDeviceScreenExperiment();

  const experiment = await prisma.experiment.create({
    data: {
      name: DeviceScreenExperimentName,
      description: "Automated end-to-end coverage. Safe to delete.",
      visible: true,
      allowNew: true,
      conditions: ["Basic"],
      participantsPerSession: 1,
      routines: deviceScreenRoutines as unknown as object,
    },
  });

  await prisma.experimentContent.createMany({
    data: deviceScreenRoutines.map((routine, progress) => ({
      experimentId: experiment.id,
      progress,
      trialNumber: 1,
      routine: routine.name,
      condition: "Basic",
      content: {},
    })),
  });

  return experiment.id;
}

export async function deleteDeviceScreenExperiment(): Promise<void> {
  await prisma.experiment.deleteMany({ where: { name: DeviceScreenExperimentName } });
}

// ── Layout bench ────────────────────────────────────────

export const LayoutExperimentName = "E2E — Layout Bench";

/**
 * One card routine whose single row is split 6:6, with an element positioned
 * in each column, plus a second element ordered into the left column below
 * the first. Before the shared layout engine, routine-card discarded
 * `layout.rows` and `element.position` entirely and rendered every element in
 * one stacked column — this is the only spec that would have caught that.
 *
 * A dedicated experiment rather than a routine appended to the Phase 13
 * bench, for the same reason as the device screen bench: inserting a routine
 * ahead of `finish` there would shift progress indices the other specs rely on.
 */
const layoutRoutines: RoutineConfig[] = [
  {
    name: "two-columns",
    type: "routine-card",
    layout: { rows: [{ columns: [{ span: 6 }, { span: 6 }] }] },
    config: { width: "900px" },
    elements: [
      {
        name: "left",
        type: "text",
        params: { content: "Column one content" },
        position: { row: 0, column: 0 },
      },
      {
        name: "right",
        type: "text",
        params: { content: "Column two content" },
        position: { row: 0, column: 1 },
      },
      {
        name: "advance",
        type: "button",
        params: { label: "Advance the layout bench" },
        position: { row: 0, column: 0, order: 1 },
        events: [{ trigger: "click", type: "proceed" }],
      },
    ],
  },
  /**
   * The borderless counterpart. Nothing wraps a borderless routine's elements,
   * so it is the one type whose cells centre their contents
   * (defaultCellAlign("routine-borderless")) — and the positionless element is
   * there because that centring used to reach only positioned ones.
   */
  {
    name: "borderless-row",
    type: "routine-borderless",
    layout: {
      rows: [{ columns: [{ span: 6 }, { span: 6 }] }, { columns: [{ span: 12 }] }],
    },
    elements: [
      {
        name: "bleft",
        type: "text",
        params: { content: "Borderless column one" },
        position: { row: 0, column: 0 },
      },
      {
        name: "bright",
        type: "text",
        params: { content: "Borderless column two" },
        position: { row: 0, column: 1 },
      },
      // No position at all: the `unplaced` bucket, which is the ordinary path
      // for programmatically built routines.
      { name: "bloose", type: "text", params: { content: "Borderless with no position" } },
      {
        name: "badvance",
        type: "button",
        params: { label: "Advance the borderless bench" },
        position: { row: 1, column: 0 },
        events: [{ trigger: "click", type: "proceed" }],
      },
    ],
  },
  {
    name: "finish",
    type: "routine-end",
    layout: { rows: [{ columns: [{ span: 12 }] }] },
    elements: [{ name: "bye", type: "text", params: { content: "Layout bench done" } }],
  },
];

export async function seedLayoutExperiment(): Promise<string> {
  await deleteLayoutExperiment();

  const experiment = await prisma.experiment.create({
    data: {
      name: LayoutExperimentName,
      description: "Automated end-to-end coverage. Safe to delete.",
      visible: true,
      allowNew: true,
      conditions: ["Basic"],
      participantsPerSession: 1,
      routines: layoutRoutines as unknown as object,
    },
  });

  await prisma.experimentContent.createMany({
    data: layoutRoutines.map((routine, progress) => ({
      experimentId: experiment.id,
      progress,
      trialNumber: 1,
      routine: routine.name,
      condition: "Basic",
      content: {},
    })),
  });

  return experiment.id;
}

export async function deleteLayoutExperiment(): Promise<void> {
  await prisma.experiment.deleteMany({ where: { name: LayoutExperimentName } });
}

// ── Element keying bench ────────────────────────────────

export const KeyingExperimentName = "E2E — Layout Keying Bench";

/**
 * Two consecutive routine-card progresses that each carry a timer named
 * `clock`, followed by an end routine.
 *
 * RoutineRenderer is a plain {#if} chain with no {#key} and runner.setContent
 * never nulls `routine`, so both progresses reuse one RoutineCard instance.
 * If LayoutGrid keys its elements by name alone, the second progress reuses
 * the FIRST progress's ElTimer: `remaining` stays at 0, its interval was
 * already cleared, and the `timeout` event never fires again — the participant
 * is trapped on trial two with a dead 0s clock. Reaching "Timer bench done"
 * therefore proves the timer remounted.
 *
 * The two routines share the element name deliberately: a differing name would
 * force a remount even under the broken key and the test would prove nothing.
 */
const TrialOneDurationSeconds = 2;
/** Longer than trial one so the countdown is still mid-flight when asserted. */
const TrialTwoDurationSeconds = 5;

function timerCard(name: string, prompt: string, duration: number): RoutineConfig {
  return card(name, [
    { name: "prompt", type: "text", params: { content: prompt } },
    {
      name: "clock",
      type: "timer",
      params: { duration, format: "seconds" },
      events: [{ trigger: "timeout", type: "proceed" }],
    },
  ]);
}

const keyingRoutines: RoutineConfig[] = [
  timerCard("timer-one", "Timer bench trial one", TrialOneDurationSeconds),
  timerCard("timer-two", "Timer bench trial two", TrialTwoDurationSeconds),
  {
    name: "finish",
    type: "routine-end",
    layout: { rows: [{ columns: [{ span: 12 }] }] },
    elements: [{ name: "bye", type: "text", params: { content: "Timer bench done" } }],
  },
];

export async function seedKeyingExperiment(): Promise<string> {
  await deleteKeyingExperiment();

  const experiment = await prisma.experiment.create({
    data: {
      name: KeyingExperimentName,
      description: "Automated end-to-end coverage. Safe to delete.",
      visible: true,
      allowNew: true,
      conditions: ["Basic"],
      participantsPerSession: 1,
      routines: keyingRoutines as unknown as object,
    },
  });

  await prisma.experimentContent.createMany({
    data: keyingRoutines.map((routine, progress) => ({
      experimentId: experiment.id,
      progress,
      trialNumber: 1,
      routine: routine.name,
      condition: "Basic",
      content: {},
    })),
  });

  return experiment.id;
}

export async function deleteKeyingExperiment(): Promise<void> {
  await prisma.experiment.deleteMany({ where: { name: KeyingExperimentName } });
}

// ── Free placement bench ────────────────────────────────

export const FreePlacementExperimentName = "E2E — Free Placement Bench";

/**
 * The WYSIWYG claim the whole stages-and-free-placement plan exists to prove:
 * an element authored at a fixed stage percentage renders at that percentage
 * of the *stage rect* regardless of the participant's window size. A locked
 * 16:9 stage lays out at a fixed internal pixel size (stageSize) and is only
 * ever visually scaled (fitStage) to fit the window, so the percentage a
 * researcher types is exact on any monitor.
 *
 * A dedicated experiment, for the same reason as the other benches: inserting
 * a routine ahead of `finish` elsewhere would shift progress indices other
 * specs rely on.
 */
const StimulusPlacement: FreePlacement = { xPct: 12, yPct: 8, wPct: 30, hPct: 9 };
const SecondPlacement: FreePlacement = { xPct: 55, yPct: 62, wPct: 28, hPct: 14 };

/**
 * A 400x400 stimulus, inline.
 *
 * A data URI rather than an uploaded Asset: `resolveSrc` passes anything that
 * is not an `asset:` reference straight through, and the point of these two
 * elements is a medium whose natural size is known exactly and cannot change
 * when someone re-exports a fixture image. An SVG with explicit width/height
 * reports those as its natural size.
 */
export const SquareStimulusPx = 400;
const SquareStimulusSrc =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SquareStimulusPx}" height="${SquareStimulusPx}">` +
      `<rect width="${SquareStimulusPx}" height="${SquareStimulusPx}" fill="#111"/>` +
      `<circle cx="200" cy="200" r="160" fill="#eee"/></svg>`,
  );

/**
 * Deliberately the wrong shape for a square stimulus: 10% of 1280 by 6% of
 * 720 is a 128x43px box for a 400x400 image. Unlocked, so nothing reshapes it.
 *
 * This is the bug this bench exists to hold shut. The image used to render at
 * its natural 400px, capped only by `max-width: 100%`, and the free box's
 * `overflow: hidden` cut off everything past 43px — a stimulus 118px tall
 * became a 118x43 slice, with nothing in the builder, the runtime or the
 * stored data saying so.
 */
const CroppableImagePlacement: FreePlacement = { xPct: 12, yPct: 30, wPct: 10, hPct: 6 };

/**
 * The same stimulus in a box that IS its shape — what "Lock aspect ratio"
 * produces. 10% of 1280 by 17.778% of 720 is 128x128: it should fill the box
 * exactly, with no bands, before and after the fit rule.
 */
const ConformingImagePlacement: FreePlacement = { xPct: 60, yPct: 20, wPct: 10, hPct: 17.778 };

const freePlacementRoutines: RoutineConfig[] = [
  {
    name: "free-stage",
    type: "routine-borderless",
    layout: { rows: [], mode: "free", stage: "16:9" },
    elements: [
      {
        name: "stimulus",
        type: "text",
        params: { content: "Free stimulus WYSIWYG target" },
        placement: StimulusPlacement,
      },
      {
        name: "second-stimulus",
        type: "text",
        params: { content: "Second free-placement corroboration target" },
        placement: SecondPlacement,
      },
      {
        name: "croppable-image",
        type: "image",
        params: { src: SquareStimulusSrc, alt: "Free stimulus in an unlocked box" },
        placement: CroppableImagePlacement,
        lockAspect: false,
      },
      {
        name: "conforming-image",
        type: "image",
        params: { src: SquareStimulusSrc, alt: "Free stimulus in a box locked to it" },
        placement: ConformingImagePlacement,
        lockAspect: true,
      },
    ],
  },
  {
    name: "finish",
    type: "routine-end",
    layout: { rows: [{ columns: [{ span: 12 }] }] },
    elements: [{ name: "bye", type: "text", params: { content: "Free placement bench done" } }],
  },
];

export async function seedFreePlacementExperiment(): Promise<string> {
  await deleteFreePlacementExperiment();

  const experiment = await prisma.experiment.create({
    data: {
      name: FreePlacementExperimentName,
      description: "Automated end-to-end coverage. Safe to delete.",
      visible: true,
      allowNew: true,
      conditions: ["Basic"],
      participantsPerSession: 1,
      routines: freePlacementRoutines as unknown as object,
    },
  });

  await prisma.experimentContent.createMany({
    data: freePlacementRoutines.map((routine, progress) => ({
      experimentId: experiment.id,
      progress,
      trialNumber: 1,
      routine: routine.name,
      condition: "Basic",
      content: {},
    })),
  });

  return experiment.id;
}

export async function deleteFreePlacementExperiment(): Promise<void> {
  await prisma.experiment.deleteMany({ where: { name: FreePlacementExperimentName } });
}

// ── References bench ───────────────────────────────────

export const ReferencesExperimentName = "E2E — References";
export const ReferencesIntroRoutine = "intro";
export const ReferencesRecapRoutine = "recap";
export const ReferencesPrompt = "Tell us your name and record a short clip";
export const ReferencesGreetingPrefix = "Welcome back,";

const referencesRoutines: RoutineConfig[] = [
  card(ReferencesIntroRoutine, [
    { name: "prompt", type: "text", params: { content: ReferencesPrompt } },
    { name: "name", type: "input-textfield", params: { placeholder: "Your name" } },
    {
      name: "clip",
      type: "recorder",
      params: {
        mode: "video",
        autoStart: true,
        showPreview: false,
        showStopButton: true,
        uploadMode: "on-stop",
        maxDuration: 3,
      },
    },
    nextButton(),
  ]),
  card(ReferencesRecapRoutine, [
    {
      name: "greeting",
      type: "text",
      params: { content: `${ReferencesGreetingPrefix} {{ref:self/p0/name}}` },
    },
    { name: "replay", type: "video", params: { src: "ref:self/p0/clip", controls: true } },
    { name: "gap", type: "text", params: { content: "[{{ref:self/p0/nothing}}]" } },
    nextButton("finish"),
  ]),
];

export async function seedReferencesExperiment(): Promise<string> {
  await prisma.experiment.deleteMany({ where: { name: ReferencesExperimentName } });

  const experiment = await prisma.experiment.create({
    data: {
      name: ReferencesExperimentName,
      description: "Automated end-to-end coverage. Safe to delete.",
      visible: true,
      allowNew: true,
      conditions: ["Basic"],
      participantsPerSession: 1,
      avCollection: true,
      routines: referencesRoutines as unknown as object,
    },
  });

  await prisma.experimentContent.createMany({
    data: referencesRoutines.map((routine, progress) => ({
      experimentId: experiment.id,
      progress,
      trialNumber: 1,
      routine: routine.name,
      condition: "Basic",
      content: {},
    })),
  });

  return experiment.id;
}

/** Uploads are files as well as rows; unlink the bytes before the cascade drops the rows. */
export async function deleteReferencesExperiment(): Promise<void> {
  const experiment = await prisma.experiment.findFirst({
    where: { name: ReferencesExperimentName },
    select: { id: true },
  });
  if (experiment) {
    const uploads = await prisma.upload.findMany({
      where: { experimentId: experiment.id },
      select: { filePath: true },
    });
    for (const upload of uploads) {
      if (upload.filePath) {
        await fs.rm(upload.filePath, { force: true });
        await fs.rm(`${upload.filePath}.json`, { force: true });
      }
    }
  }
  await prisma.experiment.deleteMany({ where: { name: ReferencesExperimentName } });
}

// ── Progress tab bench ─────────────────────────────────

export const ProgressExperimentName = "E2E — Progress Tab";
export const ProgressAdminEmail = "progress-admin@e2e.test";
export const ProgressAdminPassword = "progress-admin-password";

const progressRoutines: RoutineConfig[] = [
  card("intro", [
    { name: "name", type: "input-textfield", params: { placeholder: "Your name" }, position: { row: 0, column: 0, order: 0 } },
    { name: "clip", type: "recorder", params: { mode: "video" }, position: { row: 0, column: 0, order: 1 } },
    { ...nextButton(), position: { row: 0, column: 0, order: 2 } },
  ]),
  card("recap", [
    { name: "replay", type: "video", params: {}, position: { row: 0, column: 0, order: 0 } },
    { name: "greeting", type: "text", params: { content: "Thanks" }, position: { row: 0, column: 0, order: 1 } },
    { ...nextButton("done"), position: { row: 0, column: 0, order: 2 } },
  ]),
  { name: "bye", type: "routine-end", layout: { rows: [{ columns: [{ span: 12 }] }] }, elements: [], config: { message: "Bye" } },
];

export async function seedProgressExperiment(): Promise<string> {
  await deleteProgressExperiment();

  const experimenter = await prisma.experimenter.create({
    data: {
      email: ProgressAdminEmail,
      password: await bcrypt.hash(ProgressAdminPassword, BcryptRounds),
      name: "Progress Admin",
      role: "EXPERIMENTER",
      status: "APPROVED",
    },
  });

  const experiment = await prisma.experiment.create({
    data: {
      name: ProgressExperimentName,
      description: "Automated end-to-end coverage. Safe to delete.",
      visible: true,
      allowNew: true,
      conditions: ["Basic"],
      participantsPerSession: 1,
      routines: progressRoutines as unknown as object,
      experimenters: { create: { experimenterId: experimenter.id } },
    },
  });

  await prisma.experimentContent.createMany({
    data: progressRoutines.map((routine, progress) => ({
      experimentId: experiment.id,
      progress,
      trialNumber: 1,
      routine: routine.name,
      condition: "Basic",
      content: {},
    })),
  });

  return experiment.id;
}

export async function deleteProgressExperiment(): Promise<void> {
  await prisma.experiment.deleteMany({ where: { name: ProgressExperimentName } });
  await prisma.experimenter.deleteMany({ where: { email: ProgressAdminEmail } });
}

// ── Pair call, custom layout or automatic panel ───────────────────────

export type PairCallLayout = "custom" | "auto";
const PairCallExperimentNames: Record<PairCallLayout, string> = {
  custom: "E2E — Pair call, custom layout",
  auto: "E2E — Pair call, automatic panel",
};
export const PairCallRoles = ["Director", "Matcher"];
export const PairCallTaskText = "Pair call task column";
const PairCallTrialRoutine = "pair-trial";

/**
 * Two participants matched FIFO into one video-chat trial.
 * - `custom`: the call is only the two tiles placed in column 0.
 * - `auto`: the routine's own panel, roles Director and Matcher, and the card
 *   title "{role} task"; the only element is the task text.
 */
export async function seedPairCallExperiment(layout: PairCallLayout = "custom"): Promise<string> {
  await deletePairCallExperiment(layout);
  const design: SessionDesign = {
    version: 1,
    id: "e2e-pair-block",
    label: "Pair block",
    cohortSize: 2,
    strategy: "fifo",
    timeoutSeconds: 120,
    timeoutAction: "wait",
    seats: [{ name: "seat-1" }, { name: "seat-2" }],
    pattern: { type: "all" },
    trials: 1,
    trialRoutine: PairCallTrialRoutine,
    interTrialRoutine: null,
    conditions: ["Basic"],
    startProgress: 0,
    matchRoutineName: `${PairCallTrialRoutine}-match`,
    endMatchRoutineName: `${PairCallTrialRoutine}-end-match`,
    partnerUnavailableText: "Your partner left the call.",
    trialContent: {},
  };
  const compiled = compileSessionDesign(design);
  const at = (column: number, order: number) => ({ row: 0, column, order });
  const task = { name: "task", type: "text", params: { content: `<p>${PairCallTaskText}</p>` } } as ElementConfig;
  const autoTrial = {
    roles: PairCallRoles,
    layout: { rows: [{ columns: [{ span: 12 }] }] },
    config: { videoLayout: "auto" as const, cardTitle: "{role} task" },
    elements: [{ ...task, position: at(0, 0) }],
  };
  const routines = compiled.routines.map((r) =>
    r.name === PairCallTrialRoutine && layout === "auto"
      ? { ...r, ...autoTrial, config: { ...r.config, ...autoTrial.config } }
      : r.name === PairCallTrialRoutine
      ? {
          ...r,
          layout: { rows: [{ columns: [{ span: 4 }, { span: 8 }] }] },
          config: { ...r.config, videoLayout: "custom" as const },
          elements: [
            { name: "partnerTile", type: "video-chat", params: { participant: "partner", label: "Partner tile" }, position: at(0, 0) },
            { name: "selfTile", type: "video-chat", params: { participant: "self", label: "Self tile" }, position: at(0, 1) },
            { ...task, position: at(1, 0) },
          ] as ElementConfig[],
        }
      : r,
  );

  const experiment = await prisma.experiment.create({
    data: {
      name: PairCallExperimentNames[layout],
      visible: true,
      allowNew: true,
      videoChat: true,
      conditions: ["Basic"],
      participantsPerSession: compiled.participantsPerSession,
      routines: routines as unknown as object,
      sessionDesigns: [design] as unknown as object,
    },
  });
  await prisma.experimentContent.createMany({
    data: compiled.contentRows.map((row) => ({
      experimentId: experiment.id,
      progress: row.progress,
      trialNumber: row.trialNumber,
      routine: row.routine,
      condition: row.condition,
      content: row.content as object,
      description: row.description,
    })),
  });
  return experiment.id;
}

export async function deletePairCallExperiment(layout: PairCallLayout = "custom"): Promise<void> {
  await prisma.experiment.deleteMany({ where: { name: PairCallExperimentNames[layout] } });
}
