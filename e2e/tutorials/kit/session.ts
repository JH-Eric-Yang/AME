import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import type { ElementType } from "ame-shared";
import { FamilyOfElement } from "ame-shared/elementFamilies";
import { probeFile } from "../../fixtures/media";
import { StimulusAudioFile, StimulusVideoFile } from "../../fixtures/mediaFiles";
import { renderElementPage } from "./render";
import { PaletteLabels, type RunInfo, type Stage, type TutorialManifest, type TutorialStep } from "./types";

const run = promisify(execFile);
const Here = path.dirname(fileURLToPath(import.meta.url));

export const TutorialOutputDir = path.resolve(Here, "../../../tutorial-output");
export const RunInfoFile = path.join(TutorialOutputDir, "run.json");

/** The size of the page and of the video. */
export const TutorialViewport = { width: 1280, height: 800 };
/** Time for the viewer to read a caption before its action starts. */
const ReadPauseMs = 700;
/** Time for the viewer to see the result of an action. */
const ResultPauseMs = 900;

/** A host for stimulus files, so the researcher pastes a short URL. Playwright serves it. */
export const StimulusHost = "https://stimuli.example.org";
export const StimulusUrls = {
  clip: `${StimulusHost}/clip.webm`,
  tone: `${StimulusHost}/tone.wav`,
  picture: `${StimulusHost}/picture.svg`,
};

const Picture = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300">
<rect width="480" height="300" fill="#f5f5f5"/><circle cx="170" cy="150" r="80" fill="#ff3d00"/>
<rect x="270" y="80" width="140" height="140" rx="16" fill="#0a0a0a"/></svg>`;

/**
 * Draws the caption bar and the cursor mark on every page of the tutorial
 * context. The caption is kept in sessionStorage, so it stays when the page
 * navigates. Playwright's video does not show the real cursor.
 */
function captionLayer(): void {
  const Key = "ame-tutorial-caption";
  const draw = () => {
    if (!document.body || document.getElementById("ame-tutorial-bar")) return;
    const style = document.createElement("style");
    style.textContent = `
      #ame-tutorial-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483646; display: flex; gap: 14px; align-items: center;
        padding: 14px 20px; background: #0a0a0a; color: #fafafa; font: 500 17px/1.35 "JetBrains Mono", ui-monospace, Menlo, monospace; pointer-events: none; }
      #ame-tutorial-bar .n { color: #ff5a24; font-weight: 700; }
      #ame-tutorial-bar .stage { margin-left: auto; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.6; }
      #ame-tutorial-bar[hidden], #ame-tutorial-cursor[hidden] { display: none; }
      #ame-tutorial-cursor { position: fixed; z-index: 2147483647; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
        border: 2px solid #ff5a24; background: rgba(255, 90, 36, 0.25); pointer-events: none; left: -50px; top: -50px; transition: transform 120ms; }
      #ame-tutorial-cursor.down { transform: scale(0.7); }`;
    document.head.append(style);
    const bar = document.createElement("div");
    bar.id = "ame-tutorial-bar";
    bar.innerHTML = '<span class="n"></span><span class="text"></span><span class="stage"></span>';
    const cursor = document.createElement("div");
    cursor.id = "ame-tutorial-cursor";
    document.body.append(bar, cursor);
    const saved = sessionStorage.getItem(Key);
    const pos = sessionStorage.getItem(`${Key}-cursor`);
    if (pos) {
      const [x, y] = JSON.parse(pos) as [number, number];
      cursor.style.left = `${x}px`;
      cursor.style.top = `${y}px`;
    }
    const show = (c: { n: number; text: string; stage: string } | null) => {
      bar.hidden = !c;
      if (!c) return;
      (bar.querySelector(".n") as HTMLElement).textContent = String(c.n);
      (bar.querySelector(".text") as HTMLElement).textContent = c.text;
      (bar.querySelector(".stage") as HTMLElement).textContent = c.stage;
    };
    show(saved ? JSON.parse(saved) : null);
    (window as unknown as Record<string, unknown>).__ameTutorialShow = (c: { n: number; text: string; stage: string }) => {
      sessionStorage.setItem(Key, JSON.stringify(c));
      show(c);
    };
    (window as unknown as Record<string, unknown>).__ameTutorialHide = (hidden: boolean) => {
      bar.hidden = hidden;
      cursor.hidden = hidden;
    };
    window.addEventListener("mousemove", (e) => {
      cursor.style.left = `${e.clientX}px`;
      cursor.style.top = `${e.clientY}px`;
      sessionStorage.setItem(`${Key}-cursor`, JSON.stringify([e.clientX, e.clientY]));
    }, true);
    window.addEventListener("mousedown", () => cursor.classList.add("down"), true);
    window.addEventListener("mouseup", () => cursor.classList.remove("down"), true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", draw);
  else draw();
}

/** Extra page text for one step. */
export interface StepExtra {
  detail?: string;
  caution?: string;
}

/** The parts of a manifest that the tutorial definition gives. */
export type ManifestParts = Pick<TutorialManifest, "summary" | "params" | "checks" | "stored" | "defects" | "notes">;

/**
 * One recorded tutorial: one browser context with one page, so the video runs
 * without a cut from the Builder to the participant view to the Results tab.
 */
export class TutorialSession {
  readonly steps: TutorialStep[] = [];
  /** The page, and so its video, starts just before the constructor runs. */
  private readonly startedAt = Date.now();

  private constructor(
    readonly type: ElementType,
    private readonly context: BrowserContext,
    readonly page: Page,
  ) {}

  static async start(browser: Browser, type: ElementType, baseURL: string): Promise<TutorialSession> {
    await fs.mkdir(path.join(TutorialOutputDir, type), { recursive: true });
    const context = await browser.newContext({
      baseURL,
      viewport: TutorialViewport,
      permissions: ["camera", "microphone"],
      recordVideo: { dir: path.join(TutorialOutputDir, type, "raw"), size: TutorialViewport },
    });
    await context.addInitScript(captionLayer);
    await context.route(`${StimulusHost}/**`, async (route) => {
      const name = new URL(route.request().url()).pathname;
      if (name === "/clip.webm") return route.fulfill({ path: StimulusVideoFile, contentType: "video/webm" });
      if (name === "/tone.wav") return route.fulfill({ path: StimulusAudioFile, contentType: "audio/wav" });
      if (name === "/picture.svg") return route.fulfill({ body: Picture, contentType: "image/svg+xml" });
      return route.fulfill({ status: 404 });
    });
    return new TutorialSession(type, context, await context.newPage());
  }

  /** Show the caption, do the actions, and keep a screenshot of the result. */
  async step(stage: Stage, caption: string, actions: () => Promise<void>, extra: StepExtra = {}): Promise<void> {
    const n = this.steps.length + 1;
    const atSec = Math.round((Date.now() - this.startedAt) / 100) / 10;
    const show = { n, text: caption, stage };
    await this.page
      .evaluate((c) => (window as unknown as { __ameTutorialShow?: (c: unknown) => void }).__ameTutorialShow?.(c), show)
      .catch(() => undefined);
    await this.page.waitForTimeout(ReadPauseMs);
    await actions();
    // The page can be new after the actions; draw the caption again.
    await this.page
      .evaluate((c) => (window as unknown as { __ameTutorialShow?: (c: unknown) => void }).__ameTutorialShow?.(c), show)
      .catch(() => undefined);
    await this.page.waitForTimeout(ResultPauseMs);
    const shot = `${this.type}/step-${n}.png`;
    await this.setLayerHidden(true);
    await this.page.screenshot({ path: path.join(TutorialOutputDir, shot) });
    await this.setLayerHidden(false);
    this.steps.push({ n, stage, caption, shot, atSec, ...extra });
  }

  private async setLayerHidden(hidden: boolean): Promise<void> {
    await this.page
      .evaluate((h) => (window as unknown as { __ameTutorialHide?: (h: boolean) => void }).__ameTutorialHide?.(h), hidden)
      .catch(() => undefined);
  }

  /**
   * Close the page, convert the video when the run passed, and write the
   * manifest and the element page.
   */
  async finish(parts: ManifestParts, passed: boolean, error: string | null): Promise<TutorialManifest> {
    const video = this.page.video();
    let failureShot: string | null = null;
    if (!passed) {
      failureShot = `${this.type}/failure.png`;
      await this.setLayerHidden(true);
      await this.page.screenshot({ path: path.join(TutorialOutputDir, failureShot) }).catch(() => (failureShot = null));
    }
    await this.context.close();
    const raw = video ? await video.path() : null;
    let mp4: string | null = null;
    let durationSec: number | null = null;
    if (raw && passed) {
      mp4 = `${this.type}.mp4`;
      const out = path.join(TutorialOutputDir, mp4);
      await run("ffmpeg", ["-v", "error", "-y", "-i", raw, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]);
      durationSec = (await probeFile(out)).durationSec;
    }
    await fs.rm(path.join(TutorialOutputDir, this.type, "raw"), { recursive: true, force: true });

    const runInfo = await readRunInfo();
    const manifest: TutorialManifest = {
      type: this.type,
      label: PaletteLabels[this.type],
      family: FamilyOfElement[this.type],
      steps: this.steps,
      video: mp4,
      durationSec,
      passed,
      error,
      failureShot,
      recordedAt: runInfo.recordedAt,
      build: runInfo.build,
      ...parts,
    };
    await fs.writeFile(path.join(TutorialOutputDir, this.type, "manifest.json"), JSON.stringify(manifest, null, 2));
    await fs.writeFile(path.join(TutorialOutputDir, `${this.type}.html`), renderElementPage(manifest));
    return manifest;
  }
}

/** The run time and build that the setup project wrote; now and "unknown" when it is missing. */
export async function readRunInfo(): Promise<RunInfo> {
  try {
    return JSON.parse(await fs.readFile(RunInfoFile, "utf8")) as RunInfo;
  } catch {
    return { recordedAt: new Date().toISOString(), build: "unknown", defined: [] };
  }
}
