/**
 * Seed a demo experiment: a pair director–matcher task over video chat.
 *
 * Run from server/:  npx tsx --env-file=../.env scripts/seedDirectorDemo.ts [owner-email] [--auto-panel]
 *
 * Two versions, each with its own name:
 * - default: a custom video layout — two Video Chat tiles in the left column.
 * - `--auto-panel`: the routine's automatic video panel on the right, and the
 *   task alone on the left (no Video Chat elements).
 *
 * Re-running replaces that version of the demo (matched by name). The owner defaults to the
 * first ADMIN experimenter. The matching band is built by the same
 * compileSessionDesign() the Session tab uses, so the block shows up there.
 */
import { PrismaClient } from "@prisma/client";
import type { ElementConfig, RoutineConfig } from "ame-shared";
import { compileSessionDesign, validateSessionDesign, type SessionDesign } from "ame-shared/sessionDesign";

const Args = process.argv.slice(2);
/** Use the routine's automatic video panel, not tiles placed on the canvas. */
const AutoPanel = Args.includes("--auto-panel");
const DemoName = AutoPanel
  ? "Demo — Director task (automatic video panel)"
  : "Demo — Director task (pair video chat)";
const Condition = "Basic";
const TrialRoutine = "director-trial";
const TrialCount = 6;
const MatchTimeoutSeconds = 300;
/** Figure size in px inside the 2×2 grid. */
const FigureSize = 120;
const Letters = ["A", "B", "C", "D"];

const prisma = new PrismaClient();

// ── Stimuli: abstract tangram-like figures, drawn inline ─────────────

/** Polygon point lists in a 100×100 box. Hard to name, easy to describe. */
const Figures: Record<string, string[]> = {
  kite: ["50,5 80,40 50,95 20,40"],
  bird: ["10,60 45,30 60,45 90,20 70,65 40,75"],
  boot: ["30,10 55,10 55,60 90,70 90,90 30,90"],
  arrow: ["10,40 60,40 60,20 90,50 60,80 60,60 10,60"],
  dancer: ["45,5 60,20 50,40 80,60 60,65 55,95 40,95 42,60 15,50 40,35"],
  house: ["50,10 90,45 75,45 75,90 25,90 25,45 10,45"],
  fish: ["10,50 35,25 70,40 90,20 90,80 70,60 35,75"],
  crown: ["10,85 10,25 30,55 50,15 70,55 90,25 90,85"],
};

function figure(id: string, opts: { framed?: boolean; label?: string } = {}): string {
  const polygons = Figures[id].map((points) => `<polygon points="${points}" fill="#222" />`).join("");
  const border = opts.framed ? "4px solid #d33" : "4px solid transparent";
  const caption = opts.label ? `<div style="font-weight:600;margin-top:4px">${opts.label}</div>` : "";
  return `<div style="display:inline-block;text-align:center;margin:6px;padding:6px;border:${border};border-radius:8px">`
    + `<svg viewBox="0 0 100 100" width="${FigureSize}" height="${FigureSize}">${polygons}</svg>${caption}</div>`;
}

const grid = (cells: string[]): string =>
  `<div style="display:grid;grid-template-columns:repeat(2,auto);justify-content:center">${cells.join("")}</div>`;

interface Trial {
  /** The four figures the Director sees, in the Director's order. */
  set: string[];
  /** Index into `set` of the figure to describe. */
  target: number;
  /** The Matcher's order, as indices into `set` — never the Director's order. */
  matcherOrder: number[];
}

const Trials: Trial[] = [
  { set: ["kite", "bird", "boot", "arrow"], target: 1, matcherOrder: [2, 0, 3, 1] },
  { set: ["dancer", "house", "fish", "crown"], target: 3, matcherOrder: [3, 1, 0, 2] },
  { set: ["boot", "fish", "kite", "dancer"], target: 0, matcherOrder: [1, 3, 0, 2] },
  { set: ["arrow", "crown", "house", "bird"], target: 2, matcherOrder: [0, 2, 3, 1] },
  { set: ["fish", "dancer", "arrow", "kite"], target: 1, matcherOrder: [3, 0, 1, 2] },
  { set: ["house", "boot", "crown", "bird"], target: 3, matcherOrder: [1, 3, 2, 0] },
];

/** The Matcher's letter for the target: the answer key. */
const answerLetter = (t: Trial): string => Letters[t.matcherOrder.indexOf(t.target)];

function trialContent(t: Trial): Record<string, unknown> {
  return {
    directorView: { content: grid(t.set.map((id, i) => figure(id, { framed: i === t.target }))) },
    matcherView: { content: grid(t.matcherOrder.map((i, k) => figure(t.set[i], { label: Letters[k] }))) },
  };
}

// ── Routines ─────────────────────────────────────────────────────────

const at = (column: number, order: number) => ({ row: 0, column, order });

const card = (name: string, elements: ElementConfig[]): RoutineConfig => ({
  name,
  type: "routine-card",
  layout: { rows: [{ columns: [{ span: 12 }] }] },
  elements: elements.map((el, i) => ({ ...el, position: at(0, i) })),
});

const text = (name: string, content: string): ElementConfig => ({ name, type: "text", params: { content } });

const proceedButton = (name: string, label: string, roles?: string[]): ElementConfig => ({
  name,
  type: "button",
  params: { label },
  events: [{ trigger: "click", type: "proceed" }],
  ...(roles ? { showForRoles: roles } : {}),
});

const consent: RoutineConfig = {
  name: "consent",
  type: "routine-consent",
  layout: { rows: [{ columns: [{ span: 12 }] }] },
  elements: [
    {
      ...text(
        "consentText",
        "<h2>Consent</h2><p>This demo study pairs you with one other person in a video call. "
          + "The study uses your camera and microphone. The study does not record the call.</p>"
          + "<p>Click the button below to agree and continue.</p>",
      ),
      position: at(0, 0),
    },
  ],
  config: { agreeLabel: "I agree", disagreeLabel: "I do not agree", withdrawOnDisagree: true },
};

const instructions = card("instructions", [
  text(
    "howTo",
    "<h2>The director task</h2>"
      + "<p>You work with a partner in a video call. The study gives one of you the role <b>Director</b> "
      + "and the other the role <b>Matcher</b>.</p>"
      + "<ul><li>The <b>Director</b> sees four figures. A red frame marks one figure. "
      + "Describe that figure so your partner can find it. Do not name its position.</li>"
      + "<li>The <b>Matcher</b> sees the same figures in a different order, with the letters A to D. "
      + "Ask questions, then select the figure that the Director describes.</li></ul>"
      + `<p>There are ${TrialCount} figures. Each trial ends when both of you click your button.</p>`
      + "<p>Next, the study finds a partner for you. Allow camera and microphone access when the browser asks.</p>",
  ),
  proceedButton("ready", "Find a partner"),
]);

const trialElements: ElementConfig[] = [
  { name: "partnerVideo", type: "video-chat", params: { participant: "partner", label: "Your partner" }, position: at(0, 0) },
  { name: "selfVideo", type: "video-chat", params: { participant: "self", label: "You" }, position: at(0, 1) },
  {
    ...text("directorTask", "<p><b>You are the Director.</b> Describe the figure in the red frame. Do not name its position.</p>"),
    showForRoles: ["Director"],
    position: at(1, 0),
  },
  { ...text("directorView", ""), showForRoles: ["Director"], position: at(1, 1) },
  { ...proceedButton("directorDone", "My partner has chosen", ["Director"]), position: at(1, 2) },
  {
    ...text("matcherTask", "<p><b>You are the Matcher.</b> Listen to the Director. Select the figure that they describe.</p>"),
    showForRoles: ["Matcher"],
    position: at(1, 0),
  },
  { ...text("matcherView", ""), showForRoles: ["Matcher"], position: at(1, 1) },
  {
    name: "choice",
    type: "input-option-group",
    params: { options: Letters.map((l) => ({ value: l, label: l })), optionType: "radio", inline: true },
    showForRoles: ["Matcher"],
    position: at(1, 2),
  },
  { ...proceedButton("matcherDone", "Confirm my choice", ["Matcher"]), position: at(1, 3) },
];

/** Custom layout: a narrow video column, so both tiles fit above the task. */
const customLayoutTrial: Pick<RoutineConfig, "elements" | "layout" | "config"> = {
  elements: trialElements,
  layout: { rows: [{ columns: [{ span: 4 }, { span: 8 }] }] },
  config: { videoLayout: "custom" },
};

/** Automatic panel: the routine draws the videos on the right; the task fills the left. */
const autoPanelTrial: Pick<RoutineConfig, "elements" | "layout" | "config"> = {
  elements: trialElements
    .filter((el) => el.type !== "video-chat")
    .map((el) => ({ ...el, position: at(0, el.position!.order) })),
  layout: { rows: [{ columns: [{ span: 12 }] }] },
  config: { videoLayout: "auto", cardTitle: "{role} task" },
};

const end: RoutineConfig = {
  name: "end",
  type: "routine-end",
  layout: { rows: [{ columns: [{ span: 8 }], justify: "center" }] },
  elements: [],
  config: { finishMode: "debrief", message: "Thank you. The demo is complete. You can close this window." },
};

// ── Build ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const ownerEmail = Args.find((arg) => !arg.startsWith("--"));
  const owner = ownerEmail
    ? await prisma.experimenter.findUnique({ where: { email: ownerEmail } })
    : await prisma.experimenter.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
  if (!owner) throw new Error(`No experimenter found${ownerEmail ? ` with email ${ownerEmail}` : " with role ADMIN"}`);

  const design: SessionDesign = {
    version: 1,
    id: "director-demo-block",
    label: "Director task block",
    cohortSize: 2,
    strategy: "fifo",
    timeoutSeconds: MatchTimeoutSeconds,
    timeoutAction: "wait",
    seats: [{ name: "seat-1" }, { name: "seat-2" }],
    assignment: { mode: "random" },
    pattern: { type: "all" },
    trials: TrialCount,
    trialRoutine: TrialRoutine,
    interTrialRoutine: null,
    conditions: [Condition],
    startProgress: 2,
    matchRoutineName: `${TrialRoutine}-match`,
    endMatchRoutineName: `${TrialRoutine}-end-match`,
    partnerUnavailableText: "Your partner left the call. Please wait, or click your button to continue.",
    trialContent: Object.fromEntries(Trials.map((t, i) => [i + 1, trialContent(t)])),
  };

  const compiled = compileSessionDesign(design);
  // The block owns its three routines; the trial routine gets the task screen here.
  const trial = AutoPanel ? autoPanelTrial : customLayoutTrial;
  const blockRoutines = compiled.routines.map((r) =>
    r.name === TrialRoutine
      ? {
          ...r,
          roles: ["Director", "Matcher"],
          elements: trial.elements,
          layout: trial.layout,
          // Keep the compiled config (partnerUnavailableText); add the video layout.
          config: { ...r.config, ...trial.config },
        }
      : r,
  );
  const routines = [consent, instructions, ...blockRoutines, end];

  const issues = validateSessionDesign(design, routines, [Condition]);
  for (const issue of issues) console.log(`${issue.level}: ${issue.message}`);
  if (issues.some((i) => i.level === "error")) throw new Error("The session design is not valid; nothing was written");

  const lastBand = Math.max(...compiled.contentRows.map((r) => r.progress));
  const rows = [
    { progress: 0, trialNumber: 1, routine: "consent", condition: Condition, content: {}, description: null },
    { progress: 1, trialNumber: 1, routine: "instructions", condition: Condition, content: {}, description: null },
    ...compiled.contentRows,
    { progress: lastBand + 1, trialNumber: 1, routine: "end", condition: Condition, content: {}, description: null },
  ];

  const key = Trials.map((t, i) => `t${i + 1}=${answerLetter(t)}`).join(", ");
  await prisma.experiment.deleteMany({ where: { name: DemoName } });
  const experiment = await prisma.experiment.create({
    data: {
      name: DemoName,
      description: `Demo. Two participants: a Director describes a framed figure, a Matcher selects it (A–D). Answer key: ${key}.`,
      visible: true,
      allowNew: true,
      videoChat: true,
      conditions: [Condition],
      participantsPerSession: compiled.participantsPerSession,
      routines: routines as unknown as object,
      sessionDesigns: [design] as unknown as object,
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
  console.log(`Steps: ${rows.map((r) => `p${r.progress} ${r.routine}`).join(" · ")}`);
  console.log(`Answer key: ${key}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
