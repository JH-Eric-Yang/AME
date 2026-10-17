import type { ElementType } from "ame-shared";
import type { ElementFamily } from "ame-shared/elementFamilies";
import type { TutorialStage } from "ame-shared/tutorials";

export type { TutorialStage as Stage } from "ame-shared/tutorials";
export const Stages: readonly TutorialStage[] = ["Build", "Run", "Results"];

export interface TutorialStep {
  n: number;
  stage: TutorialStage;
  /** One ASD-STE100 instruction; the video shows the same text. */
  caption: string;
  /** More text for the page only. */
  detail?: string;
  /** A caution that the page shows before the step's result. */
  caution?: string;
  /** Screenshot path relative to tutorial-output/. */
  shot: string;
  /** Seconds from the start of the video to the start of this step, to 0.1 s. */
  atSec: number;
}

/** One row of the "Params in this tutorial" table. */
export interface ParamRow {
  key: string;
  label: string;
  help: string;
  defaultValue: string;
  value: string;
}

/** Everything one tutorial run writes to <type>/manifest.json; the pages render from it. */
export interface TutorialManifest {
  type: ElementType;
  label: string;
  family: ElementFamily;
  summary: string;
  steps: TutorialStep[];
  params: ParamRow[];
  checks: string[];
  /** The participant's stored response for the routine, as the database holds it. */
  stored: unknown;
  defects: string[];
  notes: string[];
  /** MP4 path relative to tutorial-output/, or null when the run failed. */
  video: string | null;
  durationSec: number | null;
  passed: boolean;
  error: string | null;
  /** The screen when the run failed, relative to tutorial-output/. */
  failureShot?: string | null;
  recordedAt: string;
  build: string;
}

export type IndexStatus = "ready" | "defect" | "failed" | "planned";

export interface IndexEntry {
  type: ElementType;
  label: string;
  family: ElementFamily;
  status: IndexStatus;
  /** The defect id or the planned phase. */
  note: string;
  steps: number | null;
  durationSec: number | null;
  href: string | null;
}

export interface RunInfo {
  recordedAt: string;
  build: string;
  /** The element types that have a tutorial definition. */
  defined: ElementType[];
}

/** The names the Builder palette shows (ElementPalette.svelte). */
export const PaletteLabels: Record<ElementType, string> = {
  text: "Text",
  image: "Image",
  video: "Video",
  audio: "Audio",
  "video-chat": "Video Chat",
  button: "Button",
  recorder: "Recorder",
  "multi-capture": "Multi-Capture",
  "input-textfield": "Text Field",
  "input-select": "Select",
  "input-slider": "Slider",
  "input-option-group": "Options",
  "input-file-picker": "File Picker",
  keyboard: "Keyboard",
  survey: "Survey",
  timer: "Timer",
  "body-detector": "Body Detect",
  "volume-check": "Vol. Check",
  "speech-recognizer": "Speech Rec.",
  "facial-expression-detector": "Face Expr.",
};
