/**
 * The stylesheet of the tutorial pages, from the approved design preview. The
 * colours are the platform tokens (client/src/routes/+layout.svelte); the
 * pages are static files, so they carry their own copy.
 */
export const FontLink =
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Outfit:wght@400;500;600;700&display=swap">';

export const PageStyle = `
:root {
  --bg: #fafafa; --surface: #ffffff; --ink: #0a0a0a; --ink-2: #555555; --ink-3: #8a8784;
  --rule: #e2e0de; --rule-2: #efeeec; --accent: #ff3d00; --accent-dim: rgba(255, 61, 0, 0.09);
  --success: #1f8a3a; --success-dim: rgba(31, 138, 58, 0.1); --danger: #cc0000; --danger-dim: rgba(204, 0, 0, 0.08);
  --family-stimulus: var(--accent); --family-response: var(--ink); --family-monitor: #c4c4c4;
  --font-display: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
  --font-body: "Outfit", "Helvetica Neue", Arial, sans-serif;
  --radius-sm: 6px; --radius: 10px; --radius-lg: 16px;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d0d0c; --surface: #161615; --ink: #f2f1ef; --ink-2: #b4b1ad; --ink-3: #85827e;
    --rule: #2b2a28; --rule-2: #1f1e1d; --accent: #ff5a24; --accent-dim: rgba(255, 90, 36, 0.14);
    --success: #4cc06b; --success-dim: rgba(76, 192, 107, 0.14); --danger: #ff5c5c; --danger-dim: rgba(255, 92, 92, 0.12);
    --family-response: #f2f1ef; --family-monitor: #6c6a67;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 400 16px/1.55 var(--font-body); -webkit-font-smoothing: antialiased; }
.page { max-width: 1120px; margin: 0 auto; padding-inline: 20px; padding-block: 28px 64px; }
a { color: inherit; }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
h1, h2, h3 { text-wrap: balance; margin: 0; }
.label { font: 500 11px/1.2 var(--font-display); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); }
.topbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding-bottom: 20px; border-bottom: 1px solid var(--rule); }
.brand { display: flex; align-items: center; gap: 10px; font: 700 17px/1 var(--font-body); text-decoration: none; }
.brand-mark { width: 18px; height: 18px; border-radius: 5px; background: var(--accent); }
.brand small { font: 500 12px/1 var(--font-display); color: var(--ink-3); letter-spacing: 0.04em; }
.mark { width: 0.62em; height: 0.62em; flex-shrink: 0; display: inline-block; }
.mark.stimulus { fill: var(--family-stimulus); } .mark.response { fill: var(--family-response); } .mark.monitor { fill: var(--family-monitor); }
.chip { display: inline-flex; align-items: center; gap: 6px; font: 500 11.5px/1 var(--font-display); padding: 5px 8px; border-radius: 999px; border: 1px solid var(--rule); color: var(--ink-2); white-space: nowrap; }
.chip.ready { color: var(--success); background: var(--success-dim); border-color: transparent; }
.chip.defect, .chip.failed { color: var(--danger); background: var(--danger-dim); border-color: transparent; }
.chip.planned { color: var(--ink-3); border-style: dashed; }
.chip .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.index-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; align-items: end; padding-block: 40px 28px; }
.index-head h1 { font: 600 clamp(30px, 5vw, 46px)/1.05 var(--font-body); letter-spacing: -0.02em; margin-top: 10px; }
.index-head p { margin: 12px 0 0; max-width: 60ch; color: var(--ink-2); }
.runcard { font: 400 12.5px/1.7 var(--font-display); color: var(--ink-2); border: 1px solid var(--rule); border-radius: var(--radius); padding: 12px 14px; background: var(--surface); min-width: 0; }
.runcard b { color: var(--ink); font-weight: 500; }
.tally { display: flex; gap: 18px; flex-wrap: wrap; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--rule-2); font-variant-numeric: tabular-nums; }
.family { margin-top: 28px; }
.family-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; padding-bottom: 10px; border-bottom: 1px solid var(--ink); }
.family-head h2 { font: 600 20px/1.2 var(--font-body); display: flex; align-items: center; gap: 10px; }
.family-head .mark { width: 14px; height: 14px; }
.family-head p { margin: 0; color: var(--ink-3); font-size: 14px; }
.rows { list-style: none; margin: 0; padding: 0; }
.row { display: grid; grid-template-columns: minmax(150px, 1.2fr) minmax(150px, 1fr) 80px 70px minmax(150px, 0.9fr); gap: 16px; align-items: center; padding: 12px 8px; border-bottom: 1px solid var(--rule-2); font-variant-numeric: tabular-nums; }
.row .name { font-weight: 600; text-decoration: none; }
a.name:hover { color: var(--accent); }
.row .type { font: 400 13px/1.2 var(--font-display); color: var(--ink-3); overflow-wrap: anywhere; }
.row .num { font: 400 13px/1.2 var(--font-display); color: var(--ink-2); text-align: right; }
.row.planned .name { color: var(--ink-3); font-weight: 500; }
.rows-head span { font: 500 10.5px/1 var(--font-display); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); }
.crumbs { display: flex; gap: 8px; flex-wrap: wrap; padding-top: 22px; font: 400 12.5px/1 var(--font-display); color: var(--ink-3); }
.crumbs a { text-decoration: none; }
.el-head { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 420px); gap: 32px; padding-block: 22px 30px; align-items: end; }
.el-head h1 { font: 600 clamp(36px, 6vw, 60px)/1 var(--font-body); letter-spacing: -0.025em; display: flex; align-items: center; gap: 14px; }
.el-head h1 .mark { width: 0.42em; height: 0.42em; }
.el-head .type { margin-top: 10px; font: 500 14px/1 var(--font-display); color: var(--ink-3); }
.el-head p { margin: 16px 0 0; max-width: 56ch; color: var(--ink-2); font-size: 17px; }
.facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border: 1px solid var(--rule); border-radius: var(--radius); background: var(--surface); margin: 0; }
.facts div { padding: 12px 14px; border-bottom: 1px solid var(--rule-2); min-width: 0; }
.facts div:nth-child(odd) { border-right: 1px solid var(--rule-2); }
.facts div:nth-last-child(-n+2) { border-bottom: 0; }
.facts dd { margin: 6px 0 0; font: 500 15px/1.2 var(--font-display); font-variant-numeric: tabular-nums; }
.facts dd.ok { color: var(--success); } .facts dd.bad { color: var(--danger); }
.player { margin: 0; border-radius: var(--radius-lg); overflow: hidden; border: 1px solid var(--rule); background: #000; }
.player video { display: block; width: 100%; height: auto; aspect-ratio: 16 / 10; background: #000; }
.player-foot { display: flex; gap: 12px; flex-wrap: wrap; justify-content: space-between; margin-top: 10px; font: 400 12.5px/1.4 var(--font-display); color: var(--ink-3); }
.failed-box { border: 1px solid var(--danger); background: var(--danger-dim); border-radius: var(--radius); padding: 16px 18px; }
.failed-box pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 400 12.5px/1.5 var(--font-display); margin: 8px 0 0; }
.body { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 40px; margin-top: 44px; }
.rail { position: sticky; top: 20px; align-self: start; display: grid; gap: 4px; }
.rail a { display: grid; grid-template-columns: 22px 1fr; gap: 8px; padding: 10px; border-radius: var(--radius-sm); text-decoration: none; border-left: 2px solid var(--rule); }
.rail a:hover { background: var(--surface); border-left-color: var(--accent); }
.rail .k { font: 700 12px/1.5 var(--font-display); color: var(--ink-3); }
.rail .t { font-weight: 600; }
.rail .s { grid-column: 2; font: 400 12px/1.3 var(--font-display); color: var(--ink-3); }
.stage-block + .stage-block { margin-top: 48px; }
.stage-title { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; padding-bottom: 12px; border-bottom: 1px solid var(--ink); }
.stage-title h2 { font: 600 24px/1.2 var(--font-body); }
.stage-title span { color: var(--ink-3); font-size: 14px; }
.steps { list-style: none; margin: 0; padding: 0; }
.step { display: grid; grid-template-columns: 44px minmax(0, 1fr) minmax(0, 1.25fr); gap: 20px; padding-block: 22px; border-bottom: 1px solid var(--rule-2); align-items: start; }
.step .n { font: 700 22px/1.2 var(--font-display); color: var(--accent); font-variant-numeric: tabular-nums; }
.step h3 { font: 600 17px/1.4 var(--font-body); }
.step p { margin: 8px 0 0; color: var(--ink-2); font-size: 15px; max-width: 46ch; }
.step .warn { margin-top: 10px; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--accent-dim); font-size: 14px; }
.step .warn b { font-family: var(--font-display); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); margin-right: 6px; }
.shot { margin: 0; border: 1px solid var(--rule); border-radius: var(--radius); overflow: hidden; background: var(--surface); }
.shot img { display: block; width: 100%; height: auto; }
.two { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 28px; margin-top: 48px; }
.panel { border: 1px solid var(--rule); border-radius: var(--radius); background: var(--surface); padding: 18px; min-width: 0; }
.panel h2 { font: 600 18px/1.2 var(--font-body); margin-bottom: 12px; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th { text-align: left; font: 500 10.5px/1 var(--font-display); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); padding: 8px 10px 8px 0; border-bottom: 1px solid var(--rule); }
td { padding: 10px 10px 10px 0; border-bottom: 1px solid var(--rule-2); vertical-align: top; }
td.p, td.v { font: 400 13px/1.3 var(--font-display); }
td.p { font-weight: 500; white-space: nowrap; }
td.v.set { color: var(--accent); font-weight: 600; }
.checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.checks li { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 10px; font-size: 14.5px; }
.checks li::before { content: ""; width: 14px; height: 14px; margin-top: 4px; border-radius: 50%; background: var(--success); }
pre.stored { margin: 14px 0 0; padding: 8px 10px; background: var(--rule-2); border-radius: var(--radius-sm); font: 400 12.5px/1.4 var(--font-display); overflow-x: auto; }
.notes { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--rule-2); font-size: 14px; color: var(--ink-2); display: grid; gap: 6px; }
.notes ul { margin: 0; padding-left: 18px; }
.foot { margin-top: 56px; padding-top: 16px; border-top: 1px solid var(--rule); font: 400 12px/1.6 var(--font-display); color: var(--ink-3); display: flex; gap: 16px; flex-wrap: wrap; justify-content: space-between; }
@media (max-width: 860px) {
  .index-head, .el-head, .two { grid-template-columns: minmax(0, 1fr); }
  .body { grid-template-columns: minmax(0, 1fr); gap: 24px; }
  .rail { position: static; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .rail .s { display: none; }
  .step { grid-template-columns: 34px minmax(0, 1fr); }
  .step .shot { grid-column: 2; }
  .row { grid-template-columns: minmax(0, 1fr) auto; row-gap: 4px; }
  .row .type { grid-column: 1; grid-row: 2; }
  .row .num, .rows-head { display: none; }
  .row .status { grid-column: 2; grid-row: 1 / span 2; }
}
@media (max-width: 480px) {
  .rail, .facts { grid-template-columns: minmax(0, 1fr); }
  .facts div:nth-child(odd) { border-right: 0; }
}
`;

/** The three family shapes (FamilyMark.svelte), as symbols that `<use>` refers to. */
export const MarkSymbols = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
<symbol id="m-stimulus" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></symbol>
<symbol id="m-response" viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10" rx="1.8"/></symbol>
<symbol id="m-monitor" viewBox="0 0 10 10"><path d="M5 0.5 L10 9.5 H0 Z"/></symbol>
</svg>`;
