/**
 * Seeds a manual test bench covering every element, including the camera-driven
 * ones the Playwright suite cannot exercise (Chromium's fake webcam has no face).
 *
 *   npm run seed:manual
 *
 * Re-running replaces the experiment. Delete it from the admin dashboard when done.
 */

import { PrismaClient } from "@prisma/client";
import type { ElementConfig, RoutineConfig } from "ame-shared";

const prisma = new PrismaClient();

const ExperimentName = "Manual Test Bench";

function card(name: string, elements: ElementConfig[]): RoutineConfig {
  return {
    name,
    type: "routine-card",
    layout: { rows: [{ columns: [{ span: 12 }] }] },
    elements,
  };
}

function text(name: string, content: string): ElementConfig {
  return { name, type: "text", params: { content } };
}

function next(label = "Next"): ElementConfig {
  return {
    name: "next",
    type: "button",
    params: { label },
    events: [{ trigger: "click", type: "proceed" }],
  };
}

const routines: RoutineConfig[] = [
  card("intro", [
    text("prompt", "Manual test bench. Each screen exercises one element."),
    next("Start"),
  ]),

  // ── Camera elements ──────────────────────────────────

  card("face-trigger", [
    text("prompt", "Smile and hold it for half a second to continue."),
    {
      name: "smile",
      type: "facial-expression-detector",
      params: {
        mode: "trigger",
        expression: "smile",
        threshold: 0.5,
        duration: 500,
        showOverlay: true,
      },
      events: [{ trigger: "detection", type: "proceed" }],
    },
  ]),

  card("face-log", [
    text("prompt", "Recording a blendshape timeline at 10 Hz. Press Next when done."),
    {
      name: "expressions",
      type: "facial-expression-detector",
      params: { mode: "log", sampleRate: 10, showOverlay: true },
    },
    next(),
  ]),

  card("body-check", [
    text("prompt", "Hold an index finger up for three seconds to continue."),
    {
      name: "pose",
      type: "body-detector",
      params: { gesture: "index-finger-up", duration: 3000, showOverlay: true },
      events: [{ trigger: "detection", type: "proceed" }],
    },
  ]),

  card("recording", [
    text("prompt", "Record a few seconds of video, then press Next."),
    {
      name: "clip",
      type: "recorder",
      params: { mode: "video", showPreview: true, showStopButton: true },
    },
    next(),
  ]),

  card("mic-check", [
    text("prompt", "Speak until the meter passes the threshold."),
    {
      name: "volume",
      type: "volume-check",
      params: { threshold: 30, message: "Say something to check your microphone." },
    },
    next(),
  ]),

  // ── Elements added in Phase 13 ───────────────────────

  card("keyboard-el", [
    text("prompt", "Keyboard element: press F or J."),
    {
      name: "keypress",
      type: "keyboard",
      params: { keys: ["f", "j"], recordMode: "first", hint: "Press F or J" },
      events: [{ trigger: "press", type: "proceed" }],
    },
  ]),

  card("options-el", [
    text("prompt", "Option group: radio, checkbox and toggle."),
    {
      name: "radio_choice",
      type: "input-option-group",
      params: {
        optionType: "radio",
        options: [
          { value: "a", label: "Option A" },
          { value: "b", label: "Option B" },
        ],
      },
    },
    {
      name: "checkbox_choice",
      type: "input-option-group",
      params: {
        optionType: "checkbox",
        inline: true,
        options: [
          { value: "x", label: "X" },
          { value: "y", label: "Y" },
          { value: "z", label: "Z" },
        ],
      },
    },
    {
      name: "toggle_choice",
      type: "input-option-group",
      params: {
        optionType: "toggle",
        inline: true,
        options: [
          { value: "low", label: "Low" },
          { value: "high", label: "High" },
        ],
      },
    },
    next(),
  ]),

  card("file-el", [
    text("prompt", "File picker: choose a file and watch it upload."),
    {
      name: "attachment",
      type: "input-file-picker",
      params: { multiple: true, maxFiles: 3, maxSizeMb: 20, label: "Choose files" },
    },
    next(),
  ]),

  card("survey-el", [
    {
      name: "questionnaire",
      type: "survey",
      params: {
        proceedOnComplete: true,
        submitLabel: "Submit",
        surveyJson: {
          elements: [
            { type: "text", name: "name", title: "What is your name?" },
            {
              type: "radiogroup",
              name: "mood",
              title: "How are you feeling?",
              choices: ["Good", "Fine", "Tired"],
            },
          ],
        },
      },
    },
  ]),

  card("change-el", [
    text("prompt", "Select element: choosing an option advances via the change trigger."),
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

  card("alert-el", [
    text("prompt", "Alert: pauses the experiment and records the invocation."),
    {
      name: "alarm",
      type: "button",
      params: { label: "Raise alert", style: "danger" },
      events: [
        { trigger: "click", type: "alert", params: { message: "This is a test alert." } },
      ],
    },
    next("Continue"),
  ]),

  {
    name: "finish",
    type: "routine-end",
    layout: { rows: [{ columns: [{ span: 12 }] }] },
    elements: [text("bye", "Manual test bench complete.")],
  },
];

async function main() {
  await prisma.experiment.deleteMany({ where: { name: ExperimentName } });

  const experiment = await prisma.experiment.create({
    data: {
      name: ExperimentName,
      description: "Every element, including the camera-driven ones. Safe to delete.",
      visible: true,
      allowNew: true,
      conditions: ["Basic"],
      participantsPerSession: 1,
      avCollection: true,
      bodyDetection: true,
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

  console.log(`\nSeeded "${ExperimentName}"`);
  console.log(`  ${routines.length} routines`);
  console.log(`\n  http://localhost:5199/experiment/${experiment.id}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
