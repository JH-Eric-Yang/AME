import type { ElementType } from "ame-shared";
import { FamilyOfElement, type ElementFamily } from "ame-shared/elementFamilies";
import { FontLink, MarkSymbols, PageStyle } from "./pageStyle";
import {
  PaletteLabels,
  Stages,
  type IndexEntry,
  type IndexStatus,
  type RunInfo,
  type Stage,
  type TutorialManifest,
} from "./types";

/**
 * Pure renderers for the tutorial pages. They take a manifest (or the index
 * entries) and return a complete HTML document; the files they refer to sit
 * beside it in tutorial-output/.
 */

const HtmlEscapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HtmlEscapes[c]);
}

/** Playwright's error messages carry terminal colour codes. */
const AnsiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (text: string) => text.replace(AnsiPattern, "");

const FamilyOrder: ElementFamily[] = ["stimulus", "response", "monitor"];

const FamilyText: Record<ElementFamily, { title: string; about: string }> = {
  stimulus: { title: "Stimulus", about: "The participant sees or hears it." },
  response: { title: "Response", about: "The participant answers with it, and AME records the answer." },
  monitor: { title: "Monitor", about: "It watches the participant or the clock, and acts without a click." },
};

const StageText: Record<Stage, { key: string; about: string; where: string }> = {
  Build: { key: "A", about: "You set up the element in the Builder.", where: "Builder" },
  Run: { key: "B", about: "A participant uses the element.", where: "participant" },
  Results: { key: "C", about: "You find the data.", where: "Results tab" },
};

const mark = (family: ElementFamily) =>
  `<svg class="mark ${family}"><use href="#m-${family}"/></svg>`;

/** "0:52" from seconds. */
export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "–";
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** "12 Oct 2026, 21:01" in the local time of the machine that ran the tutorials. */
function formatRunTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${date}, ${time}`;
}

function document(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${FontLink}
<style>${PageStyle}</style>
</head>
<body>
${MarkSymbols}
<div class="page">
<header class="topbar"><a class="brand" href="index.html"><span class="brand-mark" aria-hidden="true"></span>AME <small>Element tutorials</small></a></header>
${body}
</div>
</body>
</html>
`;
}

function stepRange(m: TutorialManifest, stage: Stage): string {
  const ns = m.steps.filter((s) => s.stage === stage).map((s) => s.n);
  if (ns.length === 0) return "";
  return ns.length === 1 ? `Step ${ns[0]}` : `Steps ${ns[0]}–${ns[ns.length - 1]}`;
}

function renderSteps(m: TutorialManifest, stage: Stage): string {
  const steps = m.steps.filter((s) => s.stage === stage);
  if (steps.length === 0) return "";
  const items = steps
    .map(
      (s) => `<li class="step">
<span class="n">${s.n}</span>
<div><h3>${escapeHtml(s.caption)}</h3>${s.detail ? `<p>${escapeHtml(s.detail)}</p>` : ""}${
        s.caution ? `<div class="warn"><b>Caution</b>${escapeHtml(s.caution)}</div>` : ""
      }</div>
<figure class="shot"><img src="${escapeHtml(s.shot)}" alt="${escapeHtml(`Step ${s.n}: ${s.caption}`)}" loading="lazy"></figure>
</li>`,
    )
    .join("\n");
  return `<section class="stage-block" id="stage-${stage.toLowerCase()}">
<div class="stage-title"><h2>${stage}</h2><span>${StageText[stage].about}</span></div>
<ol class="steps" start="${steps[0].n}">
${items}
</ol>
</section>`;
}

export function renderElementPage(m: TutorialManifest): string {
  const family = FamilyText[m.family];
  const media =
    m.passed && m.video
      ? `<figure class="player"><video controls preload="metadata" src="${escapeHtml(m.video)}" poster="${escapeHtml(
          m.steps[m.steps.length - 1]?.shot ?? "",
        )}"></video></figure>
<div class="player-foot"><span>${escapeHtml(m.video)} · 1280 × 800 · the captions are part of the video</span><span>${formatDuration(
          m.durationSec,
        )}</span></div>`
      : `<div class="failed-box" role="alert"><b>The run failed.</b> The tutorial run stopped before the end, so this page has no video. The steps below are the steps that passed.${
          m.error ? `<pre>${escapeHtml(stripAnsi(m.error))}</pre>` : ""
        }${
          m.failureShot
            ? `<figure class="shot" style="margin-top:12px"><img src="${escapeHtml(m.failureShot)}" alt="The screen when the run failed."></figure>`
            : ""
        }</div>`;

  const rail = Stages.filter((stage) => m.steps.some((s) => s.stage === stage))
    .map(
      (stage) =>
        `<a href="#stage-${stage.toLowerCase()}"><span class="k">${StageText[stage].key}</span><span class="t">${stage}</span><span class="s">${stepRange(
          m,
          stage,
        )} · ${StageText[stage].where}</span></a>`,
    )
    .join("\n");

  const params =
    m.params.length === 0
      ? ""
      : `<section class="panel" aria-labelledby="p-params"><h2 id="p-params">Params in this tutorial</h2><div class="table-wrap"><table>
<thead><tr><th>Param</th><th>What it does</th><th>Default</th><th>Here</th></tr></thead><tbody>
${m.params
  .map(
    (p) =>
      `<tr><td class="p">${escapeHtml(p.key)}</td><td>${escapeHtml(p.help)}</td><td class="v">${escapeHtml(
        p.defaultValue,
      )}</td><td class="v${p.value !== p.defaultValue ? " set" : ""}">${escapeHtml(p.value)}</td></tr>`,
  )
  .join("\n")}
</tbody></table></div></section>`;

  const notes = [
    `<span class="label">Known defects</span>${
      m.defects.length ? `<ul>${m.defects.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}</ul>` : "<span>None for this element.</span>"
    }`,
    ...(m.notes.length ? [`<span class="label">Notes</span><ul>${m.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`] : []),
  ].join("");

  const checks = `<section class="panel" aria-labelledby="p-checks"><h2 id="p-checks">What the test checked</h2>
<ul class="checks">${m.checks.map((c) => `<li><span>${escapeHtml(c)}</span></li>`).join("")}</ul>
${m.stored !== undefined && m.stored !== null ? `<pre class="stored">${escapeHtml(JSON.stringify(m.stored, null, 2))}</pre>` : ""}
<div class="notes">${notes}</div></section>`;

  const body = `<nav class="crumbs" aria-label="Breadcrumb"><a href="index.html">All elements</a><span>/</span><span>${family.title}</span><span>/</span><span>${escapeHtml(
    m.label,
  )}</span></nav>
<section class="el-head">
<div><h1>${mark(m.family)}${escapeHtml(m.label)}</h1><div class="type">${m.type} · ${m.family}</div><p>${escapeHtml(m.summary)}</p></div>
<dl class="facts">
<div><dt class="label">Steps</dt><dd>${m.steps.length}</dd></div>
<div><dt class="label">Video</dt><dd>${formatDuration(m.durationSec)}</dd></div>
<div><dt class="label">Test result</dt><dd class="${m.passed ? "ok" : "bad"}">${m.passed ? "Passed" : "Failed"}</dd></div>
<div><dt class="label">Recorded</dt><dd>${escapeHtml(formatRunTime(m.recordedAt))}</dd></div>
</dl>
</section>
${media}
<div class="body">
<nav class="rail" aria-label="Stages">${rail}</nav>
<div>${Stages.map((stage) => renderSteps(m, stage)).join("\n")}</div>
</div>
<div class="two">${params}${checks}</div>
<footer class="foot"><span>Recorded by npm run tutorials · ${escapeHtml(m.build)}</span><span>tutorial-output / ${m.type}.html</span></footer>`;

  return document(`${m.label} tutorial`, body);
}

const StatusText: Record<IndexStatus, (note: string) => string> = {
  ready: () => "Ready",
  defect: (note) => `Defect ${note}`,
  failed: () => "Failed",
  planned: (note) => `Planned · ${note}`,
};

function chip(entry: IndexEntry): string {
  const dot = entry.status === "planned" ? "" : '<span class="dot"></span>';
  return `<span class="chip ${entry.status}">${dot}${escapeHtml(StatusText[entry.status](entry.note))}</span>`;
}

/**
 * One index entry for each element type. A type with a tutorial definition
 * but no manifest failed before its run could write one (a seed error, a
 * time-out), so it shows as failed, never as planned.
 */
export function indexEntries(
  types: ElementType[],
  manifests: TutorialManifest[],
  defined: ElementType[],
  plannedNote: (type: ElementType) => string,
): IndexEntry[] {
  return types.map((type) => {
    const base = { type, label: PaletteLabels[type], family: FamilyOfElement[type] };
    const m = manifests.find((x) => x.type === type);
    if (!m) {
      return defined.includes(type)
        ? { ...base, status: "failed", note: "no result", steps: null, durationSec: null, href: null }
        : { ...base, status: "planned", note: plannedNote(type), steps: null, durationSec: null, href: null };
    }
    const status: IndexStatus = !m.passed ? "failed" : m.defects.length ? "defect" : "ready";
    return {
      ...base,
      status,
      note: status === "defect" ? (m.defects[0].match(/E2E-D\d+/)?.[0] ?? "") : "",
      steps: m.steps.length,
      durationSec: m.durationSec,
      href: `${type}.html`,
    };
  });
}

export function renderIndex(entries: IndexEntry[], run: RunInfo): string {
  const count = (status: IndexStatus) => entries.filter((e) => e.status === status).length;
  const tally = [
    `<span><b>${count("ready")}</b> ready</span>`,
    `<span><b>${count("defect")}</b> with a defect</span>`,
    ...(count("failed") ? [`<span><b>${count("failed")}</b> failed</span>`] : []),
    `<span><b>${count("planned")}</b> planned</span>`,
  ].join("");

  const families = FamilyOrder.map((family) => {
    const rows = entries
      .filter((e) => e.family === family)
      .map((e) => {
        const name = e.href
          ? `<a class="name" href="${escapeHtml(e.href)}">${escapeHtml(e.label)}</a>`
          : `<span class="name">${escapeHtml(e.label)}</span>`;
        return `<li class="row ${e.status}">${name}<span class="type">${e.type}</span><span class="num">${
          e.steps ?? "–"
        }</span><span class="num">${formatDuration(e.durationSec)}</span><span class="status">${chip(e)}</span></li>`;
      })
      .join("\n");
    return `<section class="family" id="family-${family}" aria-labelledby="f-${family}">
<div class="family-head"><h2 id="f-${family}">${mark(family)}${FamilyText[family].title}</h2><p>${FamilyText[family].about}</p></div>
<ul class="rows">${rows}</ul>
</section>`;
  }).join("\n");

  const body = `<section class="index-head">
<div><div class="label">tutorial-output / index.html</div>
<h1>Learn each element by watching it work</h1>
<p>Each tutorial shows one element from start to end. You build it in the Builder, a participant uses it, and you find the data on the Results tab. The e2e run records every tutorial, so each step on these pages passed a test.</p></div>
<div class="runcard" aria-label="Run details">
<div><b>Run</b> ${escapeHtml(formatRunTime(run.recordedAt))}</div>
<div><b>Command</b> npm run tutorials</div>
<div><b>Build</b> ${escapeHtml(run.build)}</div>
<div class="tally">${tally}</div>
</div>
</section>
<div class="row rows-head" aria-hidden="true"><span>Element</span><span>Type</span><span style="text-align:right">Steps</span><span style="text-align:right">Video</span><span>Status</span></div>
${families}
<footer class="foot"><span>Element names match the Builder palette.</span><span>Recorded by npm run tutorials</span></footer>`;

  return document("AME Element Tutorials", body);
}
