import { describe, it, expect, vi } from "vitest";
import type { ElementConfig, RoutineConfig } from "ame-shared";
import type { RefWhere } from "ame-shared/refs";
import {
  resolveReferences,
  escapeHtml,
  type ReferenceLookups,
  type ResolveContext,
  type UploadRecord,
} from "../references/resolve.js";

const routines: RoutineConfig[] = [
  {
    name: "intro",
    type: "routine-card",
    layout: { rows: [] },
    elements: [
      { name: "name", type: "input-textfield", params: {} },
      { name: "clip", type: "recorder", params: {} },
      { name: "survey-1", type: "survey", params: {} },
    ],
  },
];

const clip: UploadRecord = { id: "u1", status: "COMPLETE", filePath: "/x/u1", mimeType: "video/webm" };

function lookups(over: Partial<ReferenceLookups> = {}): ReferenceLookups {
  return {
    latestResult: vi.fn(async (_p: string, where: RefWhere) =>
      where.kind === "position" && where.n === 0
        ? { routine: "intro", response: { name: "Ada <b>L</b>", "survey-1": { q1: "yes", q2: 7 } } }
        : null,
    ),
    latestUpload: vi.fn(async (_p: string, where: RefWhere, element: string) =>
      where.kind === "position" && where.n === 0 && element === "clip" ? clip : null,
    ),
    ...over,
  };
}

function ctx(over: Partial<ResolveContext> = {}): ResolveContext {
  return {
    selfId: "me",
    session: null,
    group: null,
    routines,
    lookups: lookups(),
    mintMediaUrl: (u) => `/api/uploads/${u.id}?token=T`,
    ...over,
  };
}

const el = (name: string, type: ElementConfig["type"], params: object): ElementConfig =>
  ({ name, type, params }) as ElementConfig;

describe("resolveReferences", () => {
  it("returns elements without refs untouched, by identity", async () => {
    const input = [el("t", "text", { content: "plain" })];
    const out = await resolveReferences(input, ctx());
    expect(out.elements[0]).toBe(input[0]);
    expect(out.unresolved).toEqual([]);
  });

  it("swaps a whole-value media ref for a signed URL", async () => {
    const out = await resolveReferences([el("v", "video", { src: "ref:self/p0/clip" })], ctx());
    expect(out.elements[0].params).toEqual({ src: "/api/uploads/u1?token=T" });
  });

  it("HTML-escapes a whole-value string a participant authored", async () => {
    const out = await resolveReferences([el("t", "text", { content: "ref:self/p0/name" })], ctx());
    expect(out.elements[0].params).toEqual({ content: "Ada &lt;b&gt;L&lt;/b&gt;" });
  });

  it("interpolates a value ref into text, HTML-escaped", async () => {
    const out = await resolveReferences(
      [el("t", "text", { content: "Hello {{ref:self/p0/name}}!" })],
      ctx(),
    );
    expect(out.elements[0].params).toEqual({ content: "Hello Ada &lt;b&gt;L&lt;/b&gt;!" });
  });

  it("selects a field and stringifies non-strings in templates", async () => {
    const out = await resolveReferences(
      [
        el("t", "text", { content: "{{ref:self/p0/survey-1.q1}} / {{ref:self/p0/survey-1.q2}}" }),
        el("d", "input-textfield", { defaultValue: "ref:self/p0/survey-1.q2" }),
      ],
      ctx(),
    );
    expect(out.elements[0].params).toEqual({ content: "yes / 7" });
    expect(out.elements[1].params).toEqual({ defaultValue: 7 });
  });

  it("walks nested params (survey JSON) too", async () => {
    const out = await resolveReferences(
      [el("s", "survey", { surveyJson: { pages: [{ title: "Hi {{ref:self/p0/name}}" }] } })],
      ctx(),
    );
    expect(out.elements[0].params).toEqual({
      surveyJson: { pages: [{ title: "Hi Ada &lt;b&gt;L&lt;/b&gt;" }] },
    });
  });

  it("does not mutate the input", async () => {
    const input = [el("v", "video", { src: "ref:self/p0/clip" })];
    await resolveReferences(input, ctx());
    expect(input[0].params).toEqual({ src: "ref:self/p0/clip" });
  });

  it("reports no-result and substitutes an empty string", async () => {
    const out = await resolveReferences(
      [el("t", "text", { content: "[{{ref:self/p9/name}}]" }), el("v", "video", { src: "ref:self/p9/clip" })],
      ctx(),
    );
    expect(out.elements[0].params).toEqual({ content: "[]" });
    expect(out.elements[1].params).toEqual({ src: "" });
    expect(out.unresolved).toEqual([
      { ref: "ref:self/p9/name", reason: "no-result" },
      { ref: "ref:self/p9/clip", reason: "no-result" },
    ]);
  });

  it("reports upload-not-complete for an in-flight upload", async () => {
    const out = await resolveReferences(
      [el("v", "video", { src: "ref:self/p0/clip" })],
      ctx({
        lookups: lookups({
          latestUpload: async () => ({ ...clip, status: "UPLOADING", filePath: null }),
        }),
      }),
    );
    expect(out.unresolved).toEqual([{ ref: "ref:self/p0/clip", reason: "upload-not-complete" }]);
  });

  it("reports a missing field path as no-result", async () => {
    const out = await resolveReferences(
      [el("t", "text", { content: "{{ref:self/p0/survey-1.q9}}" })],
      ctx(),
    );
    expect(out.unresolved).toEqual([{ ref: "ref:self/p0/survey-1.q9", reason: "no-result" }]);
  });

  it("exposes uploadId and mimeType as media fields", async () => {
    const out = await resolveReferences(
      [el("t", "text", { content: "{{ref:self/p0/clip.uploadId}} {{ref:self/p0/clip.mimeType}}" })],
      ctx(),
    );
    expect(out.elements[0].params).toEqual({ content: "u1 video/webm" });
  });

  it("reports an unknown media field as no-result rather than falling back to the URL", async () => {
    const out = await resolveReferences(
      [el("t", "text", { content: "{{ref:self/p0/clip.duration}}" })],
      ctx(),
    );
    expect(out.elements[0].params).toEqual({ content: "" });
    expect(out.unresolved).toEqual([{ ref: "ref:self/p0/clip.duration", reason: "no-result" }]);
  });

  it("degrades to lookup-failed when a lookup throws, without rejecting", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await resolveReferences(
      [el("t", "text", { content: "[{{ref:self/p0/name}}]" })],
      ctx({ lookups: lookups({ latestResult: async () => { throw new Error("db down"); } }) }),
    );
    expect(out.elements[0].params).toEqual({ content: "[]" });
    expect(out.unresolved).toEqual([{ ref: "ref:self/p0/name", reason: "lookup-failed" }]);
    warn.mockRestore();
  });

  it("reports a malformed ref instead of silently blanking it", async () => {
    const out = await resolveReferences([el("t", "text", { content: "[{{ref:nonsense}}]" })], ctx());
    expect(out.elements[0].params).toEqual({ content: "[]" });
    expect(out.unresolved).toEqual([{ ref: "ref:nonsense", reason: "malformed" }]);
  });

  it("groups the unresolved refs by the element they were found in", async () => {
    const out = await resolveReferences(
      [
        el("a", "text", { content: "{{ref:self/p9/name}} {{ref:self/p0/name}}" }),
        el("b", "video", { src: "ref:self/p9/clip" }),
        el("c", "text", { content: "{{ref:self/p0/name}}" }),
      ],
      ctx(),
    );
    expect([...out.unresolvedByElement]).toEqual([
      ["a", [{ ref: "ref:self/p9/name", reason: "no-result" }]],
      ["b", [{ ref: "ref:self/p9/clip", reason: "no-result" }]],
    ]);
  });

  it("stringifies a whole answer object as escaped JSON in a template", async () => {
    const out = await resolveReferences(
      [el("t", "text", { content: "{{ref:self/p0/survey-1}}" })],
      ctx(),
    );
    expect(out.elements[0].params).toEqual({
      content: "{&quot;q1&quot;:&quot;yes&quot;,&quot;q2&quot;:7}",
    });
  });

  it("passes addressing failures through with their reason", async () => {
    const out = await resolveReferences(
      [el("v", "video", { src: "ref:partner/p0/clip" })],
      ctx(),
    );
    expect(out.unresolved).toEqual([{ ref: "ref:partner/p0/clip", reason: "no-session" }]);
  });

  it("resolves partner data when a session and group are supplied", async () => {
    const latestUpload = vi.fn(async (p: string) => (p === "them" ? clip : null));
    const out = await resolveReferences(
      [el("v", "video", { src: "ref:partner/p0/clip" })],
      ctx({
        session: { members: [{ participantId: "me", seat: 0, slotName: null }, { participantId: "them", seat: 1, slotName: null }] },
        group: { members: [{ participantId: "me", seat: 0, slotName: null }, { participantId: "them", seat: 1, slotName: null }] },
        lookups: lookups({ latestUpload }),
      }),
    );
    expect(out.elements[0].params).toEqual({ src: "/api/uploads/u1?token=T" });
    expect(latestUpload).toHaveBeenCalledWith("them", { kind: "position", n: 0 }, "clip");
  });

  it("looks each distinct ref up once even when it appears several times", async () => {
    const l = lookups();
    await resolveReferences(
      [
        el("a", "text", { content: "{{ref:self/p0/name}} {{ref:self/p0/name}}" }),
        el("b", "text", { content: "{{ref:self/p0/name}}" }),
      ],
      ctx({ lookups: l }),
    );
    expect(l.latestResult).toHaveBeenCalledTimes(1);
  });

  it("passes the trial routine qualifier through to the lookup", async () => {
    const l = lookups();
    await resolveReferences([el("t", "text", { content: "{{ref:self/t2:intro/name}}" })], ctx({ lookups: l }));
    expect(l.latestResult).toHaveBeenCalledWith("me", { kind: "trial", k: 2, routine: "intro" });
  });
});

describe("resolveReferences — video-chat tiles", () => {
  const tileRoutines: RoutineConfig[] = [
    {
      name: "chat",
      type: "routine-card",
      layout: { rows: [] },
      elements: [
        { name: "thread", type: "video-chat", params: { channels: ["text"] } },
        { name: "cam", type: "video-chat", params: { record: true } },
        { name: "talk", type: "video-chat", params: { record: true, channels: ["video", "audio", "text"] } },
      ],
    },
  ];
  const transcript = [
    { seat: 0, text: "hi", at: 1 },
    { seat: 1, text: "hello <b>", at: 2 },
  ];

  it("a text tile's bare ref is its transcript and .text joins the messages", async () => {
    const out = await resolveReferences(
      [
        el("t", "text", { content: "{{ref:self/p0/thread.text}}" }),
        el("d", "input-textfield", { defaultValue: "ref:self/p0/thread" }),
      ],
      ctx({
        routines: tileRoutines,
        lookups: lookups({ latestResult: async () => ({ routine: "chat", response: { thread: transcript } }) }),
      }),
    );
    expect(out.elements[0].params).toEqual({ content: "hi\nhello &lt;b&gt;" });
    expect(out.elements[1].params).toEqual({ defaultValue: transcript });
  });

  it("a recorded text tile's transcript resolves like a text tile's under <tile>__transcript", async () => {
    const latestUpload = vi.fn(async () => clip);
    const out = await resolveReferences(
      [
        el("t", "text", { content: "{{ref:self/p0/talk__transcript.text}}" }),
        el("d", "input-textfield", { defaultValue: "ref:self/p0/talk__transcript" }),
        el("v", "video", { src: "ref:self/p0/talk" }),
      ],
      ctx({
        routines: tileRoutines,
        lookups: lookups({
          latestResult: async () => ({ routine: "chat", response: { talk__transcript: transcript } }),
          latestUpload,
        }),
      }),
    );
    expect(out.elements[0].params).toEqual({ content: "hi\nhello &lt;b&gt;" });
    expect(out.elements[1].params).toEqual({ defaultValue: transcript });
    expect(out.elements[2].params).toEqual({ src: "/api/uploads/u1?token=T" });
    expect(latestUpload).toHaveBeenCalledTimes(1);
    expect(out.unresolved).toEqual([]);
  });

  it("a transcript name on a tile that records without text is an ordinary missing value", async () => {
    const out = await resolveReferences(
      [el("t", "text", { content: "[{{ref:self/p0/cam__transcript.text}}]" })],
      ctx({ routines: tileRoutines, lookups: lookups({ latestResult: async () => ({ routine: "chat", response: {} }) }) }),
    );
    expect(out.elements[0].params).toEqual({ content: "[]" });
    expect(out.unresolved).toEqual([{ ref: "ref:self/p0/cam__transcript.text", reason: "no-result" }]);
  });

  it("a recorded tile resolves to its upload", async () => {
    const latestUpload = vi.fn(async () => clip);
    const out = await resolveReferences(
      [el("v", "video", { src: "ref:self/p0/cam" })],
      ctx({ routines: tileRoutines, lookups: lookups({ latestUpload }) }),
    );
    expect(out.elements[0].params).toEqual({ src: "/api/uploads/u1?token=T" });
    expect(latestUpload).toHaveBeenCalledWith("me", { kind: "position", n: 0 }, "cam");
  });
});

describe("resolveReferences — pre-fill and conditions", () => {
  it("fills a defaultValue with the participant's own text, unescaped", async () => {
    const out = await resolveReferences(
      [el("again", "input-textfield", { defaultValue: "ref:self/p0/name", placeholder: "{{ref:self/p0/name}}" })],
      ctx(),
    );
    expect(out.elements[0].params).toEqual({ defaultValue: "Ada <b>L</b>", placeholder: "Ada &lt;b&gt;L&lt;/b&gt;" });
  });

  it("keeps a number a number and splices a template inside defaultValue as plain text", async () => {
    const out = await resolveReferences(
      [
        el("score", "input-slider", { defaultValue: "ref:self/p0/survey-1.q2" }),
        el("note", "input-textfield", { defaultValue: "Hi {{ref:self/p0/name}}" }),
      ],
      ctx(),
    );
    expect(out.elements.map((e) => e.params)).toEqual([{ defaultValue: 7 }, { defaultValue: "Hi Ada <b>L</b>" }]);
  });

  it("resolves a ref in a showWhen property into values without touching the filter", async () => {
    const gate = {
      ...el("gated", "text", { content: "hi" }),
      showWhen: [{ property: "ref:self/p0/survey-1.q1", operator: "eq" as const, value: "yes" }],
    };
    const out = await resolveReferences([gate], ctx());
    expect(out.values.get("ref:self/p0/survey-1.q1")).toBe("yes");
    expect(out.elements[0]).toEqual(gate);
    expect(out.unresolved).toEqual([]);
  });

  it("reports an unresolved condition against its element and leaves it out of values", async () => {
    const gate = {
      ...el("gated", "text", {}),
      showWhen: [{ property: "ref:self/p5/name", operator: "eq" as const, value: "x" }],
    };
    const out = await resolveReferences([gate], ctx());
    expect(out.values.has("ref:self/p5/name")).toBe(false);
    expect(out.unresolvedByElement.get("gated")).toEqual([{ ref: "ref:self/p5/name", reason: "no-result" }]);
  });

  it("has no values when nothing references earlier data", async () => {
    const out = await resolveReferences([el("t", "text", { content: "plain" })], ctx());
    expect(out.values.size).toBe(0);
  });
});

describe("escapeHtml", () => {
  it("escapes the five significant characters", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });
});
