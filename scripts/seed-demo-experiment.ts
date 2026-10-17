/**
 * Seeds "Demo — Element Configuration": one free-layout routine per group of
 * builder features, so every control the Inspector offers is visible in one
 * experiment and on one participant run.
 *
 *   npm run seed:demo
 *
 * What it covers, routine by routine:
 *   welcome     text typography (family, size, weight, colour, alignment, line
 *               height, highlight), an image with alt + fit, a large
 *               right-aligned button
 *   typography  six text boxes, one per typography variant, incl. a custom
 *               font stack; a small left-aligned button
 *   media       image (locked aspect), video (muted autoplay, loop, controls),
 *               audio (controls); a medium centred button
 *   inputs      multiline textfield with max length, select with options,
 *               slider with step / default / labels / shown value
 *   timer       mm:ss countdown with a warning threshold that advances on
 *               timeout, plus a progress-bar timer; a secondary Skip button
 *   finish      routine-end debrief
 *
 * Every content routine is `routine-borderless` in free mode on a 16:9 stage
 * (the only routine type whose surface is the stage), with placements that
 * never overlap.
 *
 * Media come from `scripts/demo-media/` and are copied into the asset store
 * the same way an upload lands there, so the Media tab, the source picker and
 * `asset:` references all work as they would for a researcher's own files.
 *
 * Re-running replaces the experiment (and its asset files). The experiment is
 * attached to every APPROVED experimenter so it shows in each dashboard.
 */

import { PrismaClient } from "@prisma/client";
import { copyFile, mkdir, stat } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "node:crypto";
import type { ElementConfig, FreePlacement, RoutineConfig, TextParams } from "ame-shared";
import { FontFamilyPresets } from "ame-shared/textStyle";
import { AssetDir, assetFilePath, unlinkAssetFile } from "../server/src/assets/storage.js";

const prisma = new PrismaClient();

export const DemoExperimentName = "Demo — Element Configuration";

const Dirname = path.dirname(fileURLToPath(import.meta.url));
const MediaDir = path.join(Dirname, "demo-media");

/** The four files under scripts/demo-media, keyed by the name routines use. */
const DemoMedia = {
  colourBars: { file: "colour-bars.png", mimeType: "image/png" },
  testPattern: { file: "test-pattern.png", mimeType: "image/png" },
  clip: { file: "demo-clip.mp4", mimeType: "video/mp4" },
  tone: { file: "demo-tone.mp3", mimeType: "audio/mpeg" },
} as const;

type MediaKey = keyof typeof DemoMedia;

/** A free-mode borderless routine on the standard 16:9 stage. */
function stage(name: string, elements: ElementConfig[]): RoutineConfig {
  return {
    name,
    type: "routine-borderless",
    layout: { rows: [], mode: "free", stage: "16:9" },
    elements,
  };
}

function at(xPct: number, yPct: number, wPct: number, hPct: number): FreePlacement {
  return { xPct, yPct, wPct, hPct };
}

function text(name: string, params: TextParams, placement?: FreePlacement): ElementConfig {
  return placement ? { name, type: "text", params, placement } : { name, type: "text", params };
}

function proceedButton(
  name: string,
  params: ElementConfig["params"],
  placement: FreePlacement,
): ElementConfig {
  return {
    name,
    type: "button",
    params,
    placement,
    events: [{ trigger: "click", type: "proceed" }],
  };
}

/** Routines, given the asset reference (`asset:<id>`) for each media file. */
function buildRoutines(src: Record<MediaKey, string>): RoutineConfig[] {
  return [
    stage("welcome", [
      text(
        "title",
        {
          content: "Element Configuration Demo",
          fontFamily: FontFamilyPresets.serif,
          fontSize: "40px",
          fontWeight: "bold",
          color: "#111111",
          textAlign: "center",
        },
        at(5, 6, 90, 12),
      ),
      text(
        "lead",
        {
          content:
            "This experiment is a tour of the builder's element configuration panel. " +
            "Every screen is a free-layout routine on a 16:9 stage, and every element on it " +
            "was styled entirely through the Inspector: no hand-written JSON, no CSS. " +
            "Open the Builder tab alongside a participant run to see each control take effect. " +
            "This paragraph is 18px sans-serif with a 1.8 line height, justified.",
          fontFamily: FontFamilyPresets.sans,
          fontSize: "18px",
          lineHeight: 1.8,
          color: "#333333",
          textAlign: "justify",
        },
        at(5, 20, 55, 40),
      ),
      {
        name: "hero",
        type: "image",
        params: {
          src: src.colourBars,
          alt: "Colour bars test card",
          objectFit: "cover",
        },
        placement: at(64, 20, 31, 40),
      },
      text(
        "sidenote",
        {
          content: "Monospace, italic, right-aligned, on a highlight.",
          fontFamily: FontFamilyPresets.mono,
          fontSize: "14px",
          fontStyle: "italic",
          textAlign: "right",
          highlight: "#fff3b0",
        },
        at(5, 64, 55, 12),
      ),
      proceedButton(
        "begin",
        { label: "Begin the tour", style: "primary", size: "large", align: "right" },
        at(64, 66, 31, 14),
      ),
    ]),

    stage("typography", [
      text(
        "t-serif-bold",
        {
          content: "Serif · Bold · 28px · Left",
          fontFamily: FontFamilyPresets.serif,
          fontSize: "28px",
          fontWeight: "bold",
          textAlign: "left",
        },
        at(4, 8, 28, 36),
      ),
      text(
        "t-sans-medium",
        {
          content: "Sans · Medium · 22px · Center",
          fontFamily: FontFamilyPresets.sans,
          fontSize: "22px",
          fontWeight: "500",
          textAlign: "center",
        },
        at(36, 8, 28, 36),
      ),
      text(
        "t-mono-italic",
        {
          content: "Monospace · Italic · 16px · Right",
          fontFamily: FontFamilyPresets.mono,
          fontSize: "16px",
          fontStyle: "italic",
          textAlign: "right",
        },
        at(68, 8, 28, 36),
      ),
      text(
        "t-line-height",
        {
          content:
            "Line height 2.2, justified. Generous leading opens a dense paragraph up, " +
            "and the justified edges show the alignment control at work across several lines " +
            "of running text inside one free-placement box.",
          fontSize: "16px",
          lineHeight: 2.2,
          textAlign: "justify",
        },
        at(4, 50, 28, 40),
      ),
      text(
        "t-colour-highlight",
        {
          content: "Semibold 600 · 20px · dark red on a highlight",
          fontSize: "20px",
          fontWeight: "600",
          color: "#b00020",
          highlight: "#ffe9a8",
          textAlign: "center",
        },
        at(36, 50, 28, 40),
      ),
      text(
        "t-custom-family",
        {
          content: "A custom family: Palatino, falling back to serif.",
          fontFamily: "'Palatino Linotype', Palatino, 'Book Antiqua', serif",
          fontSize: "24px",
          textAlign: "left",
        },
        at(68, 50, 28, 26),
      ),
      proceedButton(
        "next-small",
        { label: "Next: media", style: "primary", size: "small", align: "left" },
        at(68, 80, 28, 10),
      ),
    ]),

    stage("media", [
      text(
        "caption",
        {
          content: "Image, video and audio, each with its playback parameters set in the Inspector",
          fontSize: "20px",
          fontWeight: "bold",
          textAlign: "center",
        },
        at(4, 4, 92, 10),
      ),
      {
        name: "picture",
        type: "image",
        params: { src: src.testPattern, alt: "Test pattern", objectFit: "contain" },
        placement: at(4, 18, 30, 45),
        lockAspect: true,
      },
      {
        name: "clip",
        type: "video",
        params: { src: src.clip, autoplay: true, muted: true, loop: true, controls: true },
        placement: at(37, 18, 40, 45),
      },
      {
        name: "tone",
        type: "audio",
        params: { src: src.tone, autoplay: false, loop: false, controls: true },
        placement: at(4, 68, 40, 12),
      },
      proceedButton(
        "next-medium",
        { label: "Next: inputs", style: "primary", size: "medium", align: "center" },
        at(60, 68, 36, 12),
      ),
      text(
        "media-note",
        {
          content:
            "The video autoplays because it is muted, which is what browsers require. " +
            "The audio waits for a click. The image is aspect-locked to its box.",
          fontSize: "14px",
          color: "#555555",
          textAlign: "center",
        },
        at(4, 84, 92, 12),
      ),
    ]),

    stage("inputs", [
      text(
        "prompt",
        { content: "Tell us about yourself", fontSize: "20px", fontWeight: "600" },
        at(4, 4, 92, 8),
      ),
      text(
        "about-label",
        { content: "Multiline text field, at most 200 characters:", fontSize: "14px" },
        at(4, 14, 44, 6),
      ),
      {
        name: "about",
        type: "input-textfield",
        params: { placeholder: "Type up to 200 characters…", multiline: true, maxLength: 200 },
        placement: at(4, 21, 44, 24),
      },
      text(
        "colour-label",
        { content: "Select, options entered as value|label:", fontSize: "14px" },
        at(52, 14, 44, 6),
      ),
      {
        name: "colour",
        type: "input-select",
        params: {
          options: [
            { value: "red", label: "Red" },
            { value: "green", label: "Green" },
            { value: "blue", label: "Blue" },
          ],
        },
        placement: at(52, 21, 44, 8),
      },
      text(
        "mood-label",
        {
          content: "Slider: 0 to 10 in steps of 0.5, default 5, end labels, value shown.",
          fontSize: "14px",
        },
        at(52, 33, 44, 6),
      ),
      {
        name: "mood",
        type: "input-slider",
        params: {
          min: 0,
          max: 10,
          step: 0.5,
          defaultValue: 5,
          leftLabel: "Calm",
          rightLabel: "Excited",
          showValue: true,
        },
        placement: at(52, 40, 44, 12),
      },
      proceedButton(
        "submit",
        { label: "Submit answers", style: "primary", size: "medium", align: "center" },
        at(30, 60, 40, 12),
      ),
      text(
        "inputs-note",
        {
          content:
            "Each input records under its own element name. Submitting uploads the three answers " +
            "and advances.",
          fontSize: "14px",
          color: "#555555",
          textAlign: "center",
        },
        at(4, 76, 92, 12),
      ),
    ]),

    stage("timer", [
      text(
        "prompt",
        {
          content:
            "Wait for the countdown. It turns red with 5 seconds left and advances at zero, " +
            "or press Skip.",
          fontSize: "18px",
          textAlign: "center",
        },
        at(4, 6, 92, 10),
      ),
      {
        name: "countdown",
        type: "timer",
        // ElTimer counts one unit per second, so these are seconds at runtime
        // even though the Inspector labels the field in ms — a known,
        // pre-existing mismatch left untouched by the configuration panel.
        params: { duration: 15, visible: true, format: "mm:ss", warningTime: 5 },
        placement: at(20, 22, 60, 20),
        events: [{ trigger: "timeout", type: "proceed" }],
      },
      text(
        "bar-label",
        {
          content: "The bar below is a second timer in progress-bar format.",
          fontSize: "14px",
          color: "#555555",
          textAlign: "center",
        },
        at(20, 46, 60, 8),
      ),
      {
        name: "bar",
        type: "timer",
        params: { duration: 15, visible: true, format: "progress-bar" },
        placement: at(20, 56, 60, 8),
      },
      proceedButton(
        "skip",
        { label: "Skip", style: "secondary", size: "small", align: "right" },
        at(60, 70, 20, 10),
      ),
    ]),

    {
      name: "finish",
      type: "routine-end",
      layout: { rows: [{ columns: [{ span: 12 }] }] },
      elements: [
        text(
          "bye",
          {
            content: "That is every control in the element configuration panel. Thank you.",
            fontSize: "18px",
            textAlign: "center",
          },
        ),
      ],
    },
  ];
}

/** Removes an earlier run's experiment together with its asset files. */
async function removeExisting(): Promise<void> {
  const existing = await prisma.experiment.findMany({
    where: { name: DemoExperimentName },
    select: { id: true, assets: { select: { filePath: true } } },
  });
  for (const experiment of existing) {
    for (const asset of experiment.assets) {
      if (asset.filePath) await unlinkAssetFile(asset.filePath);
    }
  }
  await prisma.experiment.deleteMany({ where: { name: DemoExperimentName } });
}

/** Copies one demo file into the asset store and records it, as an upload would. */
async function seedAsset(experimentId: string, key: MediaKey): Promise<string> {
  const { file, mimeType } = DemoMedia[key];
  const source = path.join(MediaDir, file);
  const id = randomUUID();
  const target = assetFilePath(id);
  await copyFile(source, target);
  const { size } = await stat(target);
  await prisma.asset.create({
    data: { id, experimentId, fileName: file, mimeType, size: BigInt(size), filePath: target },
  });
  return `asset:${id}`;
}

async function main() {
  await removeExisting();
  await mkdir(AssetDir, { recursive: true });

  const experimenters = await prisma.experimenter.findMany({
    where: { status: "APPROVED" },
    select: { id: true, email: true },
  });
  if (experimenters.length === 0) {
    throw new Error("No APPROVED experimenter exists, so nobody could see the demo — sign up first.");
  }

  const experiment = await prisma.experiment.create({
    data: {
      name: DemoExperimentName,
      description:
        "Tour of the element configuration panel: typography, media, inputs, timers, " +
        "all on free-layout stages. Safe to delete.",
      visible: true,
      allowNew: true,
      conditions: ["Basic"],
      participantsPerSession: 1,
      routines: [],
      experimenters: { create: experimenters.map((e) => ({ experimenterId: e.id })) },
    },
  });

  const src = {
    colourBars: await seedAsset(experiment.id, "colourBars"),
    testPattern: await seedAsset(experiment.id, "testPattern"),
    clip: await seedAsset(experiment.id, "clip"),
    tone: await seedAsset(experiment.id, "tone"),
  };

  const routines = buildRoutines(src);
  await prisma.experiment.update({
    where: { id: experiment.id },
    data: { routines: routines as unknown as object },
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

  console.log(`\nSeeded "${DemoExperimentName}"`);
  console.log(`  ${routines.length} routines, ${Object.keys(src).length} assets`);
  console.log(`  visible to: ${experimenters.map((e) => e.email).join(", ")}`);
  console.log(`\n  Builder:     http://localhost:5180/admin/dashboard/experiment/${experiment.id}`);
  console.log(`  Participant: http://localhost:5180/experiment/${experiment.id}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
