/**
 * Seed a demo experiment: an adult reads four picture books aloud, as if to a
 * child, while a phone and the laptop webcam record them from the waist up.
 *
 * Run from server/:  npx tsx --env-file=../.env scripts/seedReadingDemo.ts [owner-email]
 *
 * Two conditions (high and low iconicity) give the same four steps; only the
 * book version named on each story screen differs. The position check uses
 * the laptop webcam; the phone is a second camera paired by QR code.
 *
 * Re-running replaces the demo (matched by name). The owner defaults to the
 * first ADMIN experimenter.
 */
import { PrismaClient } from "@prisma/client";
import type { ElementConfig, RoutineConfig } from "ame-shared";

const DemoName = "Demo — Picture book reading (phone camera)";
const Conditions = ["high-iconicity", "low-iconicity"];
const ConditionLabels: Record<string, string> = {
  "high-iconicity": "Version A",
  "low-iconicity": "Version B",
};
const StoryCount = 4;
/** A safety limit for one story, in seconds; a story takes 3–5 minutes. */
const MaxStorySeconds = 420;
/** Pose landmarks 0–16 (face, shoulders, elbows, wrists) and 23–24 (hips). */
const WaistUpLandmarks = [...Array.from({ length: 17 }, (_, i) => i), 23, 24];
/** How long the participant must hold the position, in milliseconds. */
const PositionHoldMs = 3000;

const prisma = new PrismaClient();

// ── Routines ─────────────────────────────────────────────────────────

const at = (order: number) => ({ row: 0, column: 0, order });
const OneColumn = { rows: [{ columns: [{ span: 12 }] }] };

const text = (name: string, content: string): ElementConfig => ({ name, type: "text", params: { content } });

const proceedButton = (name: string, label: string): ElementConfig => ({
  name,
  type: "button",
  params: { label },
  events: [{ trigger: "click", type: "proceed" }],
});

const card = (name: string, elements: ElementConfig[]): RoutineConfig => ({
  name,
  type: "routine-card",
  layout: OneColumn,
  elements: elements.map((el, i) => ({ ...el, position: at(i) })),
});

const consent: RoutineConfig = {
  name: "consent",
  type: "routine-consent",
  layout: OneColumn,
  elements: [
    {
      ...text(
        "consentText",
        "<h2>Consent</h2>"
          + "<p>In this study, you read four picture books aloud. Read each book as if you read it to a young child.</p>"
          + "<p>The study records video and audio of you from the waist up. "
          + "It uses the camera of this computer and the camera of your phone.</p>"
          + "<p>Click the button below to agree and continue.</p>",
      ),
      position: at(0),
    },
  ],
  config: { agreeLabel: "I agree", disagreeLabel: "I do not agree", withdrawOnDisagree: true },
};

const instructions = card("instructions", [
  text(
    "howTo",
    "<h2>Before you start</h2>"
      + "<p>You need these items:</p>"
      + "<ul><li>The four picture books that we sent to you.</li>"
      + "<li>Your phone, with the battery charged or connected to a charger.</li>"
      + "<li>A quiet room with good light.</li></ul>"
      + "<p>Do these steps:</p>"
      + "<ol><li>Sit in a chair in front of this computer.</li>"
      + "<li>Put your phone on a stand or against a stable object, approximately 1.5 metres in front of you.</li>"
      + "<li>Turn off the screen lock on your phone.</li>"
      + "<li>Hold a book in your hands, at the position where you read it.</li></ol>"
      + "<p>There is no child with you. Read each book as if a child of 3 to 5 years sits next to you. "
      + "Each book takes approximately 3 to 5 minutes.</p>",
  ),
  proceedButton("ready", "Continue"),
]);

const positionCheck: RoutineConfig = {
  name: "position-check",
  type: "routine-pos-check",
  layout: OneColumn,
  elements: [
    {
      ...text(
        "positionHint",
        "<p>Hold a book in your hands, at the position where you read it. "
          + "Make sure that the camera shows your head, your hands and your waist.</p>",
      ),
      position: at(0),
    },
  ],
  config: { mode: "custom", targetLandmarks: WaistUpLandmarks, requiredDuration: PositionHoldMs },
};

/** The phone's slot. The connect step and every story use this label, so the phone stays paired. */
const PhoneSource = { label: "phone", capabilities: ["camera", "microphone"], facingMode: "environment" };
/** The steps before the stories: consent, instructions, position check, connect phone. */
const FirstStoryProgress = 4;

const connectPhone: RoutineConfig = card("connect-phone", [
  text(
    "connectHint",
    "<h2>Connect your phone</h2>"
      + "<ol><li>Scan the QR code with your phone.</li>"
      + "<li>On your phone, select <b>phone</b> and allow camera access.</li>"
      + "<li>Put the phone on its stand, approximately 1.5 metres in front of you.</li>"
      + "<li>Hold a book in your hands. Make sure that the phone video shows you from the waist up, with the book.</li>"
      + "<li>When the screen shows <b>All devices are connected</b>, click <b>Continue</b>.</li></ol>"
      + "<p>Keep the AME page open on your phone until the end of the study. "
      + "The phone stays connected for all four books.</p>",
  ),
  {
    name: "pairing",
    type: "multi-capture",
    params: { sources: [PhoneSource], includeDesktop: true, desktopMode: "video", pairOnly: true, showPreview: true },
  },
  proceedButton("connected", "Continue"),
]);

/** A book step: one short instruction, the two previews, Start Recording and Next. Pairing is on connect-phone. */
const readStory: RoutineConfig = card("read-story", [
  // Overridden on every step with the story number and the book version.
  text("storyIntro", ""),
  {
    name: "reading",
    type: "multi-capture",
    params: {
      sources: [PhoneSource],
      includeDesktop: true,
      desktopMode: "video",
      maxDuration: MaxStorySeconds,
      autoStart: false,
      uploadMode: "streaming",
      showPreview: true,
      showPairing: false,
      showStopButton: false,
    },
  },
  // Next also stops the recording and waits for the upload.
  proceedButton("finished", "Next"),
]);

const end: RoutineConfig = {
  name: "end",
  type: "routine-end",
  layout: { rows: [{ columns: [{ span: 8 }], justify: "center" }] },
  elements: [],
  config: {
    finishMode: "debrief",
    message: "Thank you. You have read all four books. The study is complete. You can close this window.",
  },
};

function storyIntro(story: number, condition: string): string {
  return `<h2>Book ${story} of ${StoryCount}: Story ${story} — ${ConditionLabels[condition]}</h2>`
    + "<p>Click <b>Start Recording</b>. Read the book aloud as if to a young child. Then click <b>Next</b>.</p>";
}

// ── Build ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const ownerEmail = process.argv[2];
  const owner = ownerEmail
    ? await prisma.experimenter.findUnique({ where: { email: ownerEmail } })
    : await prisma.experimenter.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
  if (!owner) throw new Error(`No experimenter found${ownerEmail ? ` with email ${ownerEmail}` : " with role ADMIN"}`);

  const routines = [consent, instructions, positionCheck, connectPhone, readStory, end];

  const rows = Conditions.flatMap((condition) => {
    const stories = Array.from({ length: StoryCount }, (_, i) => ({
      progress: FirstStoryProgress + i,
      trialNumber: i + 1,
      routine: "read-story",
      condition,
      content: { storyIntro: { content: storyIntro(i + 1, condition) } },
      description: `Story ${i + 1} (${condition})`,
    }));
    return [
      { progress: 0, trialNumber: 1, routine: "consent", condition, content: {}, description: null },
      { progress: 1, trialNumber: 1, routine: "instructions", condition, content: {}, description: null },
      { progress: 2, trialNumber: 1, routine: "position-check", condition, content: {}, description: null },
      { progress: 3, trialNumber: 1, routine: "connect-phone", condition, content: {}, description: null },
      ...stories,
      { progress: FirstStoryProgress + StoryCount, trialNumber: 1, routine: "end", condition, content: {}, description: null },
    ];
  });

  await prisma.experiment.deleteMany({ where: { name: DemoName } });
  const experiment = await prisma.experiment.create({
    data: {
      name: DemoName,
      description:
        "Demo. One participant reads four picture books aloud, as if to a child. "
        + "A position check (laptop webcam) needs the head, the hands and the hips in view. "
        + "Each book is recorded by the phone and the laptop webcam. "
        + "Conditions: high-iconicity (Version A) and low-iconicity (Version B).",
      visible: true,
      allowNew: true,
      avCollection: true,
      bodyDetection: true,
      supplementaryDevice: "CAMERA",
      conditions: Conditions,
      participantsPerSession: 1,
      routines: routines as unknown as object,
      experimenters: { create: { experimenterId: owner.id } },
      contents: {
        create: rows.map((r) => ({
          progress: r.progress,
          trialNumber: r.trialNumber,
          routine: r.routine,
          condition: r.condition,
          content: r.content as object,
          description: r.description,
        })),
      },
    },
  });

  console.log(`Created "${DemoName}" (${experiment.id}) for ${owner.email}`);
  console.log(`Steps per condition: ${rows.filter((r) => r.condition === Conditions[0]).map((r) => `p${r.progress} ${r.routine}`).join(" · ")}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
