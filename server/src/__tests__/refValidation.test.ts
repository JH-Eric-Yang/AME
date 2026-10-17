import { describe, it, expect } from "vitest";
import type { ElementConfig, RoutineConfig, RoutineType } from "ame-shared";
import { parseRef } from "ame-shared/refs";
import { stepsFor, type SequenceRow } from "ame-shared/progressSequence";
import {
  sequenceContext,
  findRefSites,
  requiredKind,
  refSafety,
  elementsAvailable,
  validateRef,
  validateStepRefs,
  type RefSite,
} from "ame-shared/refValidation";

const routine = (name: string, type: RoutineType, extra: Partial<RoutineConfig> = {}): RoutineConfig => ({
  name, type, layout: { rows: [] }, elements: [], ...extra,
});
const el = (name: string, type: ElementConfig["type"], extra: Partial<ElementConfig> = {}): ElementConfig =>
  ({ name, type, params: {}, ...extra }) as ElementConfig;
const row = (p: Partial<SequenceRow> & { progress: number; routine: string }): SequenceRow => ({
  trialNumber: 1, condition: "Basic", content: {}, description: null, ...p,
});

const routines: RoutineConfig[] = [
  routine("intro", "routine-card", { elements: [el("name", "input-textfield"), el("clip", "recorder"), el("late", "recorder", { onsetTime: 500 })] }),
  routine("match", "routine-matching", { matching: { strategy: "fifo", slots: [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }] } }),
  routine("chat", "routine-video-chat", {
    interactionPattern: { type: "round-robin", groupSize: 2 },
    elements: [el("rec", "recorder"), el("tile", "video-chat")],
  }),
  routine("survey", "routine-card", { elements: [el("q", "survey")] }),
  routine("end-match", "routine-end-matching"),
  routine("debrief", "routine-card", { elements: [el("replay", "video"), el("text", "text"), el("tile2", "video-chat")] }),
];

// 0 intro · 1 match · 2 chat t1 · 3 chat t2 · 4 chat t3 · 5 survey t3 · 6 end-match · 7 debrief
const rows: SequenceRow[] = [
  row({ progress: 0, routine: "intro" }),
  row({ progress: 1, routine: "match" }),
  row({ progress: 2, routine: "chat", trialNumber: 1 }),
  row({ progress: 3, routine: "chat", trialNumber: 2 }),
  row({ progress: 4, routine: "chat", trialNumber: 3 }),
  row({ progress: 5, routine: "survey", trialNumber: 3 }),
  row({ progress: 6, routine: "end-match" }),
  row({ progress: 7, routine: "debrief" }),
];
// Trials 2–3 only: every non-trial row sits at trialNumber 1, and a range
// starting there would shuffle intro/match/end-match along with trial 1.
const shuffle = [{ fromTrial: 2, toTrial: 3, method: "shuffle" as const }];
const ctx = sequenceContext(rows, "Basic", routines, shuffle);
const stepAt = (n: number) => ctx.steps.find((s) => s.position === n)!;
const where = (s: string) => parseRef(s)!.where;

const site = (raw: string, element = "text", param = "content", whole = false): RefSite =>
  ({ raw, parsed: parseRef(raw), element, param, whole });
const mediaSite = (raw: string): RefSite => site(raw, "replay", "src", true);
const messages = (issues: { message: string }[]) => issues.map((i) => i.message);

describe("sequenceContext", () => {
  it("builds steps, one band and one shuffled range", () => {
    expect(ctx.steps).toHaveLength(8);
    expect(ctx.bands).toEqual([expect.objectContaining({ from: 1, to: 6, cohortSize: 4, groupSize: 2 })]);
    expect(ctx.ranges).toEqual([expect.objectContaining({ from: 3, to: 5, trials: [2, 3] })]);
  });
});

describe("findRefSites / requiredKind", () => {
  it("finds whole-value and template refs, merging content overrides over defaults", () => {
    const elements = [
      el("replay", "video", { params: { src: "asset:x" } }),
      el("text", "text", { params: { content: "Hi {{ref:self/p0/name}}" } }),
      el("q", "survey", { params: { surveyJson: { pages: [{ title: "{{ref:self/p0/name}} again" }] } } }),
    ];
    const sites = findRefSites(elements, { replay: { src: "ref:self/p0/clip" } });
    expect(sites.map((s) => [s.element, s.param, s.whole, s.raw])).toEqual([
      ["replay", "src", true, "ref:self/p0/clip"],
      ["text", "content", false, "ref:self/p0/name"],
      ["q", "surveyJson", false, "ref:self/p0/name"],
    ]);
  });

  it("keeps a malformed ref with parsed === null", () => {
    const sites = findRefSites([el("t", "text", { params: { content: "ref:bad" } })], {});
    expect(sites[0].parsed).toBeNull();
  });

  it("a whole-value src on image/video/audio needs media; everything else accepts a value", () => {
    expect(requiredKind(mediaSite("ref:self/p0/clip"), "video")).toBe("media");
    expect(requiredKind(site("ref:self/p0/clip", "text", "content", true), "text")).toBe("value");
    expect(requiredKind(site("ref:self/p0/clip", "replay", "src", false), "video")).toBe("value");
  });
});

describe("refSafety — positions", () => {
  it("accepts an earlier unshuffled step", () => {
    expect(refSafety(where("ref:self/p0/x"), 7, ctx)).toEqual({ ok: true, targets: [stepAt(0)] });
  });

  it("rejects the same or a later step, and a step that does not exist", () => {
    expect(refSafety(where("ref:self/p7/x"), 7, ctx)).toEqual({ ok: false, message: "p7 is not before p7" });
    expect(refSafety(where("ref:self/p9/x"), 7, ctx)).toEqual({ ok: false, message: "p9 names no step in this condition" });
  });

  it("expands a shuffled position to every step that can land there when referenced from after the range", () => {
    const safety = refSafety(where("ref:self/p3/x"), 7, ctx);
    expect(safety.ok && safety.targets.map((s) => s.position)).toEqual([3, 4, 5]);
  });

  it("rejects a position inside the same shuffled range as the referencing step", () => {
    expect(refSafety(where("ref:self/p3/x"), 4, ctx)).toEqual({
      ok: false,
      message: "p3 and p4 are both in a shuffled range (p3–p5) and may swap; use t<K>",
    });
    // p2 is trial 1, outside the range, so it is a plain earlier step.
    expect(refSafety(where("ref:self/p2/x"), 4, ctx)).toEqual({ ok: true, targets: [stepAt(2)] });
  });
});

describe("refSafety — trials", () => {
  it("accepts a trial referenced from after its shuffled range", () => {
    const safety = refSafety(where("ref:self/t2/x"), 7, ctx);
    expect(safety.ok && safety.targets.map((s) => s.position)).toEqual([3]);
  });

  it("accepts an earlier step of the referencing step's own trial", () => {
    const safety = refSafety(where("ref:self/t3/x"), 5, ctx);
    expect(safety.ok && safety.targets.map((s) => s.position)).toEqual([4]);
  });

  it("rejects the own trial when nothing of it precedes the step", () => {
    expect(refSafety(where("ref:self/t2/x"), 3, ctx)).toEqual({
      ok: false, message: "t2: no earlier step of trial 2 before p3",
    });
  });

  it("rejects another trial referenced from inside the range", () => {
    expect(refSafety(where("ref:self/t2/x"), 4, ctx)).toEqual({
      ok: false, message: "t2 may run after p4: p4 is inside or before the shuffled range p3–p5",
    });
  });

  it("rejects a trial with no steps, and honours the routine qualifier", () => {
    expect(refSafety(where("ref:self/t7/x"), 7, ctx)).toEqual({ ok: false, message: "t7 names no step in this condition" });
    const safety = refSafety(where("ref:self/t3:survey/x"), 7, ctx);
    expect(safety.ok && safety.targets.map((s) => s.position)).toEqual([5]);
  });

  it("rejects an unshuffled later trial", () => {
    const plain = sequenceContext(rows, "Basic", routines, []);
    expect(refSafety(where("ref:self/t3/x"), 3, plain)).toEqual({ ok: false, message: "t3 at p4 is not before p3" });
  });
});

describe("elementsAvailable", () => {
  it("intersects producers across every target and filters by kind", () => {
    const targets = [stepAt(2), stepAt(3), stepAt(4), stepAt(5)];
    expect(elementsAvailable(targets, routines, "media").map((e) => e.name)).toEqual([]);
    // "tile" has default params — no `record`, default channels — so it
    // produces nothing to reference (spec §6.1) and is not listed.
    expect(elementsAvailable([stepAt(2), stepAt(3)], routines, "media").map((e) => e.name)).toEqual(["rec"]);
    expect(elementsAvailable([stepAt(0)], routines, null).map((e) => e.name)).toEqual(["name", "clip", "late"]);
  });
});

describe("validateRef", () => {
  it("reports a ref that does not parse", () => {
    expect(messages(validateRef(site("ref:nope"), stepAt(7), ctx))).toEqual(["`ref:nope` does not parse"]);
  });

  it("is clean for a valid self/p0 media ref into a video src", () => {
    expect(validateRef(mediaSite("ref:self/p0/clip"), stepAt(7), ctx)).toEqual([]);
  });

  it("requires a matching block for partner and seat", () => {
    expect(messages(validateRef(site("ref:partner/p0/clip"), stepAt(0), ctx))).toEqual([
      "`ref:partner/p0/clip` needs a matching block: p0 is outside routine-matching → routine-end-matching",
    ]);
  });

  it("bounds partner:k by the group size and seat:n by the cohort", () => {
    expect(messages(validateRef(site("ref:partner:2/p0/name"), stepAt(3), ctx))).toEqual([
      "`ref:partner:2/p0/name`: the group at p3 has 2 members, so the last partner is partner:1",
    ]);
    expect(validateRef(site("ref:partner/p0/name"), stepAt(3), ctx)).toEqual([]);
    expect(messages(validateRef(site("ref:seat:5/p0/name"), stepAt(3), ctx))).toEqual([
      "`ref:seat:5/p0/name`: the cohort has 4 seats",
    ]);
    expect(validateRef(site("ref:seat:4/p0/name"), stepAt(3), ctx)).toEqual([]);
  });

  it("passes safety failures through", () => {
    expect(messages(validateRef(site("ref:self/p9/name"), stepAt(7), ctx))).toEqual([
      "p9 names no step in this condition",
    ]);
  });

  it("flags an ambiguous trial ref and accepts a qualified one", () => {
    const twice = [...rows, row({ progress: 8, routine: "chat", trialNumber: 3 }), row({ progress: 9, routine: "debrief" })];
    const c = sequenceContext(twice, "Basic", routines, []);
    const from = c.steps.find((s) => s.position === 9)!;
    expect(messages(validateRef(site("ref:self/t3/rec"), from, c))).toEqual([
      "`ref:self/t3/rec` is ambiguous: trial 3 runs chat at p4, p8; add :routine or use p<N>",
    ]);
    expect(messages(validateRef(site("ref:self/t3:chat/rec"), from, c))).toEqual([
      "`ref:self/t3:chat/rec` is ambiguous: trial 3 runs chat at p4, p8; add :routine or use p<N>",
    ]);
    expect(validateRef(site("ref:self/t3/q"), from, c)).toEqual([]);
  });

  it("flags every target that lacks the element", () => {
    expect(messages(validateRef(site("ref:self/p3/rec"), stepAt(7), ctx))).toEqual([
      '`ref:self/p3/rec`: survey at p5 has no element "rec"',
    ]);
  });

  it("flags a non-producer and a value producer in a media src", () => {
    // A fake p8 (same routine as p7) references p7's text element.
    const p8 = { ...stepAt(7), position: 8 };
    expect(messages(validateRef(site("ref:self/p7/text"), p8, { ...ctx, steps: [...ctx.steps, p8] }))).toEqual([
      '`ref:self/p7/text`: "text" (text) produces nothing to reference',
    ]);
    expect(messages(validateRef(mediaSite("ref:self/p0/name"), stepAt(7), ctx))).toEqual([
      '`ref:self/p0/name`: a media source needs a recording or file, but "name" is a input-textfield',
    ]);
  });

  it("accepts a media producer inside text (it yields its URL)", () => {
    expect(validateRef(site("ref:self/p0/clip"), stepAt(7), ctx)).toEqual([]);
  });

  it("warns when the producer may not have run", () => {
    const issues = validateRef(site("ref:self/p0/late"), stepAt(7), ctx);
    expect(issues).toEqual([{ level: "warn", ref: "ref:self/p0/late", message: expect.stringContaining("may not have run") }]);
  });

  it("warns for a producer restricted to some seats or to a property filter", () => {
    const restricted = routines.map((r) =>
      r.name === "intro"
        ? routine("intro", "routine-card", {
            elements: [
              el("seated", "input-textfield", { showForSeats: [1] }),
              el("filtered", "input-textfield", { showWhen: [{ property: "age", operator: "gt", value: 18 }] }),
            ],
          })
        : r,
    );
    const c = sequenceContext(rows, "Basic", restricted, shuffle);
    expect(messages(validateRef(site("ref:self/p0/seated"), stepAt(7), c))).toEqual([
      '`ref:self/p0/seated`: "seated" may not have run for every participant (shown only to seats 1)',
    ]);
    expect(messages(validateRef(site("ref:self/p0/filtered"), stepAt(7), c))).toEqual([
      '`ref:self/p0/filtered`: "filtered" may not have run for every participant (shown conditionally)',
    ]);
  });
});

describe("video-chat tiles", () => {
  const tile = (name: string, params: object, extra: Partial<ElementConfig> = {}): ElementConfig =>
    ({ name, type: "video-chat", params, ...extra }) as ElementConfig;

  const build = (chatElements: ElementConfig[], chatExtra: Partial<RoutineConfig> = {}, debriefContent: Record<string, unknown> = {}) => {
    const routines: RoutineConfig[] = [
      routine("match", "routine-matching", { matching: { strategy: "fifo", slots: [{ name: "a" }, { name: "b" }] } }),
      routine("chat", "routine-card", { elements: chatElements, ...chatExtra }),
      routine("debrief", "routine-card", { elements: [el("replay", "video"), el("text", "text")] }),
      routine("end-match", "routine-end-matching"),
    ];
    const rows: SequenceRow[] = [
      row({ progress: 0, routine: "match" }),
      row({ progress: 1, routine: "chat" }),
      row({ progress: 2, routine: "debrief", content: debriefContent }),
      row({ progress: 3, routine: "end-match" }),
    ];
    const ctx = sequenceContext(rows, "Basic", routines, []);
    return { rows, ctx, at: (n: number) => ctx.steps.find((s) => s.position === n)! };
  };
  const messages = (issues: { level: string; message: string }[]) => issues.map((i) => `${i.level}: ${i.message}`);

  it("a media src may reference a recorded tile but not a text tile", () => {
    const { rows, ctx, at } = build(
      [tile("cam", { participant: "self", record: true }), tile("thread", { channels: ["text"] })],
      {},
      { replay: { src: "ref:self/p1/thread" }, text: { content: "{{ref:self/p1/cam}} {{ref:self/p1/thread.text}}" } },
    );
    expect(messages(validateStepRefs(at(2), rows, ctx))).toEqual([
      'error: `ref:self/p1/thread`: a media source needs a recording or file, but "thread" is a video-chat',
    ]);
  });

  it("a recorded text tile's transcript is a value under <tile>__transcript", () => {
    const talk = tile("talk", { participant: "self", record: true, channels: ["video", "audio", "text"] });
    const ok = build([talk], {}, { text: { content: "{{ref:self/p1/talk__transcript.text}} {{ref:self/p1/talk__transcript}}" } });
    expect(validateStepRefs(ok.at(2), ok.rows, ok.ctx)).toEqual([]);

    const asMedia = build([talk], {}, { replay: { src: "ref:self/p1/talk__transcript" } });
    expect(messages(validateStepRefs(asMedia.at(2), asMedia.rows, asMedia.ctx))).toEqual([
      'error: `ref:self/p1/talk__transcript`: a media source needs a recording or file, but "talk__transcript" is a video-chat',
    ]);

    const noText = build([tile("cam", { participant: "self", record: true })], {}, { text: { content: "{{ref:self/p1/cam__transcript}}" } });
    expect(messages(validateStepRefs(noText.at(2), noText.rows, noText.ctx))).toEqual([
      'error: `ref:self/p1/cam__transcript`: chat at p1 has no element "cam__transcript"',
    ]);
  });

  it("elementsAvailable offers a recorded text tile's transcript as a value", () => {
    const { ctx, at } = build([tile("talk", { participant: "self", record: true, channels: ["video", "text"] })]);
    expect(elementsAvailable([at(1)], ctx.routines, "value").map((e) => e.name)).toEqual(["talk__transcript"]);
    expect(elementsAvailable([at(1)], ctx.routines, "media").map((e) => e.name)).toEqual(["talk"]);
  });

  it("a tile that neither records nor has text produces nothing to reference", () => {
    const { rows, ctx, at } = build([tile("plain", {})], {}, { text: { content: "{{ref:self/p1/plain}}" } });
    expect(messages(validateStepRefs(at(2), rows, ctx))).toContain(
      'error: `ref:self/p1/plain`: "plain" (video-chat) produces nothing to reference',
    );
  });

  it("flags an unparseable participant and out-of-range partner and seat", () => {
    const { rows, ctx, at } = build([
      tile("bad", { participant: "everyone" }),
      tile("far", { participant: "partner:2" }),
      tile("ghost", { participant: "seat:3" }),
      tile("ok", { participant: "seat:2" }),
    ]);
    expect(messages(validateStepRefs(at(1), rows, ctx))).toEqual([
      'error: video-chat "bad": "everyone" is not self, partner, partner:k or seat:n',
      'error: video-chat "far": the group at p1 has 2 members, so the last partner is partner:1',
      'error: video-chat "ghost": the cohort has 2 seats',
    ]);
  });

  it("flags record on a tile with no media channel", () => {
    const { rows, ctx, at } = build([tile("thread", { channels: ["text"], record: true })]);
    expect(messages(validateStepRefs(at(1), rows, ctx))).toEqual([
      'error: video-chat "thread" records, but lists no video or audio channel',
    ]);
  });

  it("warns when text tiles share a screen, and not when roles keep them apart", () => {
    const shared = build([tile("t1", { channels: ["text"] }), tile("t2", { channels: ["text", "audio"] })]);
    expect(messages(validateStepRefs(shared.at(1), shared.rows, shared.ctx))).toEqual([
      'warn: video-chat tiles "t1", "t2" show the same text thread; keep text on one tile',
    ]);
    const apart = build(
      [tile("t1", { channels: ["text"] }, { showForRoles: ["A"] }), tile("t2", { channels: ["text"] }, { showForRoles: ["B"] })],
      { roles: ["A", "B"] },
    );
    expect(validateStepRefs(apart.at(1), apart.rows, apart.ctx)).toEqual([]);
  });

  it("warns when a tile expects a channel nobody publishes", () => {
    const mismatch = build([tile("me", { participant: "self", channels: ["audio"] }), tile("them", {})]);
    expect(messages(validateStepRefs(mismatch.at(1), mismatch.rows, mismatch.ctx))).toEqual([
      'warn: video-chat "them" expects video from its participant, but no screen in this routine publishes video',
    ]);
    const symmetric = build([tile("me", { participant: "self" }), tile("them", { channels: ["audio"] })]);
    expect(validateStepRefs(symmetric.at(1), symmetric.rows, symmetric.ctx)).toEqual([]);
  });

  it("with roles, another role must publish what a tile expects", () => {
    const { rows, ctx, at } = build(
      [
        tile("directorSees", {}, { showForRoles: ["Director"] }),
        tile("matcherSelf", { participant: "self", channels: ["audio"] }, { showForRoles: ["Matcher"] }),
        tile("matcherHears", { channels: ["audio"] }, { showForRoles: ["Matcher"] }),
        tile("directorSelf", { participant: "self" }, { showForRoles: ["Director"] }),
      ],
      { roles: ["Director", "Matcher"] },
    );
    expect(messages(validateStepRefs(at(1), rows, ctx))).toEqual([
      'warn: video-chat "directorSees" expects video from its participant, but no screen in this routine publishes video',
    ]);
  });

  it("reads a per-step override of the tile's params", () => {
    const { ctx, at } = build([tile("them", {})]);
    const rows: SequenceRow[] = [
      row({ progress: 0, routine: "match" }),
      row({ progress: 1, routine: "chat", content: { them: { channels: ["text"], record: true } } }),
      row({ progress: 2, routine: "debrief" }),
      row({ progress: 3, routine: "end-match" }),
    ];
    expect(messages(validateStepRefs(at(1), rows, ctx))).toEqual([
      'error: video-chat "them" records, but lists no video or audio channel',
    ]);
  });
});

describe("references in defaultValue and showWhen", () => {
  const prefill = routine("prefill", "routine-card", {
    elements: [
      el("again", "input-textfield", { params: { defaultValue: "ref:self/p0/name" } }),
      el("wrong", "input-textfield", { params: { defaultValue: "ref:self/p0/clip" } }),
      el("gated", "text", { showWhen: [{ property: "ref:self/p0/name", operator: "eq", value: "Ada" }] }),
      el("badGate", "text", { showWhen: [{ property: "ref:self/p0/clip", operator: "eq", value: "x" }] }),
      el("plainGate", "text", { showWhen: [{ property: "language", operator: "eq", value: "en" }] }),
    ],
  });
  const seq = [row({ progress: 0, routine: "intro" }), row({ progress: 1, routine: "prefill" })];
  const pctx = sequenceContext(seq, "Basic", [...routines, prefill], []);
  const step1 = pctx.steps.find((s) => s.position === 1)!;

  it("finds a whole ref in a showWhen property as a site", () => {
    expect(findRefSites(prefill.elements, {}).filter((s) => s.param === "showWhen")).toEqual([
      { raw: "ref:self/p0/name", parsed: parseRef("ref:self/p0/name"), element: "gated", param: "showWhen", whole: true },
      { raw: "ref:self/p0/clip", parsed: parseRef("ref:self/p0/clip"), element: "badGate", param: "showWhen", whole: true },
    ]);
  });

  it("a default value or a condition must reference an answer, not a recording", () => {
    expect(messages(validateStepRefs(step1, seq, pctx))).toEqual([
      '`ref:self/p0/clip`: a default value needs a recorded answer, but "clip" is a recorder',
      '`ref:self/p0/clip`: a condition needs a recorded answer, but "clip" is a recorder',
    ]);
  });

  it("checks the ordering of a reference in a condition like any other", () => {
    const early = routine("early", "routine-card", {
      elements: [el("gate", "text", { showWhen: [{ property: "ref:self/p1/name", operator: "eq", value: "Ada" }] })],
    });
    const rows2 = [row({ progress: 0, routine: "early" }), row({ progress: 1, routine: "intro" })];
    const c2 = sequenceContext(rows2, "Basic", [...routines, early], []);
    expect(messages(validateStepRefs(c2.steps[0], rows2, c2))).toEqual(["p1 is not before p0"]);
  });
});

describe("validateStepRefs", () => {
  it("collects issues from routine defaults and content overrides, and flags video-chat outside a band", () => {
    const withRefs = rows.map((r) =>
      r.progress === 7 ? { ...r, content: { replay: { src: "ref:self/p0/name" }, text: { content: "{{ref:self/p9/name}}" } } } : r,
    );
    const c = sequenceContext(withRefs, "Basic", routines, shuffle);
    const issues = validateStepRefs(c.steps[7], withRefs, c);
    expect(messages(issues)).toEqual([
      '`ref:self/p0/name`: a media source needs a recording or file, but "name" is a input-textfield',
      "p9 names no step in this condition",
      'video-chat "tile2" is outside a matching block',
    ]);
    expect(issues.every((i) => i.level === "error")).toBe(true);
  });

  it("is empty for a step with nothing to check", () => {
    expect(validateStepRefs(ctx.steps[0], rows, ctx)).toEqual([]);
  });

  it("warns when a showWhen condition has no property", () => {
    const blankRoutines: RoutineConfig[] = [
      routine("intro", "routine-card", {
        elements: [el("name", "input-textfield", { showWhen: [{ property: "", operator: "eq", value: "x" }] })],
      }),
    ];
    const blankRows: SequenceRow[] = [row({ progress: 0, routine: "intro" })];
    const c = sequenceContext(blankRows, "Basic", blankRoutines, []);
    const issues = validateStepRefs(c.steps[0], blankRows, c);
    expect(issues).toEqual([
      {
        level: "warn",
        ref: "",
        message: 'showWhen on "name" has a condition with no property, so the element is never shown',
      },
    ]);
  });

  it("warns once per element even when a whitespace-only property is combined with a filled one", () => {
    const routines2: RoutineConfig[] = [
      routine("intro", "routine-card", {
        elements: [el("name", "input-textfield", { showWhen: [{ property: "  ", operator: "eq", value: "x" }, { property: "age", operator: "gt", value: 18 }] })],
      }),
    ];
    const rows2: SequenceRow[] = [row({ progress: 0, routine: "intro" })];
    const c = sequenceContext(rows2, "Basic", routines2, []);
    expect(validateStepRefs(c.steps[0], rows2, c)).toEqual([
      {
        level: "warn",
        ref: "",
        message: 'showWhen on "name" has a condition with no property, so the element is never shown',
      },
    ]);
  });

  it("does not warn when a showWhen condition's property is filled", () => {
    const cleanRoutines: RoutineConfig[] = [
      routine("intro", "routine-card", {
        elements: [el("name", "input-textfield", { showWhen: [{ property: "age", operator: "gt", value: 18 }] })],
      }),
    ];
    const cleanRows: SequenceRow[] = [row({ progress: 0, routine: "intro" })];
    const cleanCtx = sequenceContext(cleanRows, "Basic", cleanRoutines, []);
    expect(validateStepRefs(cleanCtx.steps[0], cleanRows, cleanCtx)).toEqual([]);
  });
});
