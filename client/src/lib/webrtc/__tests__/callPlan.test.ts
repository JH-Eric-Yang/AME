import { describe, it, expect } from "vitest";
import type { ElementConfig, SessionMember } from "ame-shared";
import {
  addressingContext,
  autoTiles,
  mediaAction,
  planCall,
  planFor,
  recordingKinds,
  RecordingStartGraceMs,
  resolveTile,
  samePlan,
  tilePlayback,
  tilesFor,
  tileStatus,
  EmptyPlan,
  type RunnerCallView,
} from "../callPlan";

const member = (n: number): SessionMember => ({ participantId: `p${n}`, seat: n, slotName: null });
const cohort = [member(0), member(1), member(2), member(3)];
const tile = (name: string, params: object): ElementConfig => ({ name, type: "video-chat", params }) as ElementConfig;

const view = (over: Partial<RunnerCallView> = {}): RunnerCallView => ({
  participantId: "p0",
  sessionId: "sess-1",
  peers: ["p1", "p2", "p3"],
  sessionMembers: cohort,
  interactionGroup: { peers: ["p1"], members: [member(0), member(1)] },
  routine: { type: "routine-card" },
  elements: [],
  ...over,
});

describe("addressingContext", () => {
  it("uses the group's members once content has named them", () => {
    expect(addressingContext(view())).toEqual({
      selfId: "p0",
      session: { members: cohort },
      group: { members: [member(0), member(1)] },
    });
  });

  it("falls back to the cohort before the first grouped content", () => {
    expect(addressingContext(view({ interactionGroup: null })).group).toEqual({ members: cohort });
  });

  it("has no session outside a matching block, or after it is cleared", () => {
    expect(addressingContext(view({ sessionId: null, sessionMembers: [] }))).toEqual({ selfId: "p0", session: null, group: null });
    // RoutineEndMatching's setMatched("", [], 0, "") empties the members too.
    expect(addressingContext(view({ sessionId: "", sessionMembers: [], interactionGroup: null })).session).toBeNull();
  });

  it("keeps the session after a reload, which restores members but never sessionId", () => {
    const reloaded = view({ sessionId: null, peers: [] });
    expect(addressingContext(reloaded).session).toEqual({ members: cohort });
    const ctx = addressingContext(reloaded);
    expect(resolveTile("t", {}, ctx)).toMatchObject({ participantId: "p1", failure: null });
    expect(resolveTile("s", { participant: "seat:3" }, ctx)).toMatchObject({ participantId: "p2", failure: null });
  });
});

describe("resolveTile", () => {
  const ctx = addressingContext(view());

  it("resolves an empty tile to the partner with video and audio", () => {
    expect(resolveTile("t", {}, ctx)).toEqual({
      name: "t", self: false, participantId: "p1", failure: null,
      channels: ["video", "audio"], media: ["video", "audio"], text: false,
      mirror: false, label: "", record: false,
    });
  });

  it("marks a self tile, and a seat that names the viewer, as self", () => {
    expect(resolveTile("me", { participant: "self" }, ctx)).toMatchObject({ self: true, participantId: "p0", mirror: true });
    expect(resolveTile("me", { participant: "seat:1" }, ctx)).toMatchObject({ self: true, participantId: "p0", mirror: true });
    expect(resolveTile("me", { participant: "seat:1", mirror: false }, ctx)).toMatchObject({ self: true, mirror: false });
  });

  it("addresses the cohort by seat, outside the current group", () => {
    expect(resolveTile("s", { participant: "seat:4" }, ctx).participantId).toBe("p3");
  });

  it("reports why a tile has nobody", () => {
    expect(resolveTile("x", { participant: "partner:2" }, ctx)).toMatchObject({ participantId: null, failure: "partner-index-out-of-range" });
    expect(resolveTile("x", { participant: "everyone" }, ctx)).toMatchObject({ participantId: null, failure: "invalid-participant" });
    expect(resolveTile("x", {}, addressingContext(view({ sessionId: null, sessionMembers: [] })))).toMatchObject({ participantId: null, failure: "no-session" });
  });

  it("carries text, label and record", () => {
    expect(resolveTile("t", { channels: ["text", "audio"], label: "Them", record: true }, ctx)).toMatchObject({
      channels: ["text", "audio"], media: ["audio"], text: true, label: "Them", record: true,
    });
  });
});

describe("planCall", () => {
  const ctx = addressingContext(view());
  const resolve = (params: object, name = "t") => resolveTile(name, params, ctx);

  it("a self and a partner tile publish both and dial the group", () => {
    expect(planCall([resolve({ participant: "self" }, "me"), resolve({})], ["p1"], "p0")).toEqual({
      publish: { video: true, audio: true }, receive: ["video", "audio"], peers: ["p1"],
    });
  });

  it("without a self tile, publishes what the remote tiles list", () => {
    expect(planCall([resolve({ channels: ["audio"] })], ["p1"], "p0")).toEqual({
      publish: { video: false, audio: true }, receive: ["audio"], peers: ["p1"],
    });
  });

  it("a self tile decides what is published even when a remote tile wants more", () => {
    expect(planCall([resolve({ participant: "self", channels: ["audio"] }, "me"), resolve({})], ["p1"], "p0").publish).toEqual({
      video: false, audio: true,
    });
  });

  it("a text-only design asks for nothing and dials nobody", () => {
    expect(planCall([resolve({ channels: ["text"] })], ["p1"], "p0")).toEqual(EmptyPlan);
  });

  it("receives without publishing when the self tile is text only", () => {
    expect(planCall([resolve({ participant: "self", channels: ["text"] }, "me"), resolve({ channels: ["video"] })], ["p1"], "p0")).toEqual({
      publish: { video: false, audio: false }, receive: ["video"], peers: ["p1"],
    });
  });

  it("dials a seat tile outside the group as well as the group", () => {
    expect(planCall([resolve({ participant: "seat:4" })], ["p1"], "p0").peers).toEqual(["p1", "p3"]);
  });

  it("keeps publishing but dials nobody when this rotation sits out", () => {
    const solo = addressingContext(view({ interactionGroup: { peers: [], members: [member(0)] } }));
    expect(planCall([resolveTile("t", {}, solo)], [], "p0")).toEqual({
      publish: { video: true, audio: true }, receive: [], peers: [],
    });
  });
});

describe("tilesFor and planFor", () => {
  it("renders the routine's video-chat elements only", () => {
    const tiles = tilesFor(view({ elements: [tile("a", {}), { name: "b", type: "text", params: {} } as ElementConfig] }));
    expect(tiles.map((t) => t.name)).toEqual(["a"]);
  });

  it("routine-video-chat adds a self tile and one tile per group peer", () => {
    const tiles = tilesFor(view({ routine: { type: "routine-video-chat", config: { recordLocal: true } } }));
    expect(tiles.map((t) => [t.name, t.participantId, t.self, t.record])).toEqual([
      ["local-video", "p0", true, true],
      ["peer-p1", "p1", false, false],
    ]);
    expect(autoTiles({ selfId: "p0", peers: ["p0", "p2"], recordLocal: false }).map((t) => t.participantId)).toEqual(["p0", "p2"]);
  });

  it("a custom routine-video-chat renders only the tiles placed in its layout", () => {
    const tiles = tilesFor(
      view({
        routine: { type: "routine-video-chat", config: { videoLayout: "custom", recordLocal: true } },
        elements: [tile("partnerVideo", {}), tile("selfVideo", { participant: "self" })],
      }),
    );
    expect(tiles.map((t) => [t.name, t.participantId])).toEqual([
      ["partnerVideo", "p1"],
      ["selfVideo", "p0"],
    ]);
    expect(planFor(view({ routine: { type: "routine-video-chat", config: { videoLayout: "custom" } } }))).toEqual(EmptyPlan);
  });

  it("plans nothing before the participant has joined", () => {
    expect(planFor(view({ participantId: "", elements: [tile("a", {})] }))).toEqual(EmptyPlan);
  });

  it("plans from the group the server assigned", () => {
    expect(planFor(view({ elements: [tile("a", {})] })).peers).toEqual(["p1"]);
  });
});

describe("samePlan and mediaAction", () => {
  const plan = { publish: { video: true, audio: true }, receive: ["video", "audio"] as const, peers: ["p1"] };

  it("compares plans by value", () => {
    expect(samePlan({ ...plan, receive: [...plan.receive] }, { ...plan, receive: [...plan.receive], peers: ["p1"] })).toBe(true);
    expect(samePlan({ ...plan, receive: [...plan.receive] }, { ...plan, receive: [...plan.receive], peers: ["p2"] })).toBe(false);
  });

  it("keeps, acquires, releases or replaces local media", () => {
    const av = { video: true, audio: true };
    const a = { video: false, audio: true };
    const none = { video: false, audio: false };
    expect(mediaAction(null, none)).toBe("keep");
    expect(mediaAction(null, av)).toBe("acquire");
    expect(mediaAction(av, { ...av })).toBe("keep");
    expect(mediaAction(av, a)).toBe("replace");
    expect(mediaAction(av, none)).toBe("release");
  });
});

describe("tileStatus and tilePlayback", () => {
  const ctx = addressingContext(view());
  const partner = resolveTile("t", {}, ctx);
  const nobody = resolveTile("t", { participant: "partner:2" }, ctx);
  const unmatched = resolveTile("t", {}, addressingContext(view({ sessionId: null, sessionMembers: [] })));

  it("is live once a stream arrives and connecting before", () => {
    expect(tileStatus(partner, { matched: true, hasStream: true, partnerDropped: false })).toBe("live");
    expect(tileStatus(partner, { matched: true, hasStream: false, partnerDropped: false })).toBe("connecting");
  });

  it("waits while matching and is unavailable when nobody is addressed or the partner left", () => {
    expect(tileStatus(unmatched, { matched: false, hasStream: false, partnerDropped: false })).toBe("waiting");
    expect(tileStatus(unmatched, { matched: true, hasStream: false, partnerDropped: false })).toBe("unavailable");
    expect(tileStatus(nobody, { matched: true, hasStream: false, partnerDropped: false })).toBe("unavailable");
    expect(tileStatus(partner, { matched: true, hasStream: false, partnerDropped: true })).toBe("unavailable");
  });

  it("never plays the viewer's own audio and hides video a tile does not list", () => {
    expect(tilePlayback(partner)).toEqual({ showVideo: true, playAudio: true });
    expect(tilePlayback(resolveTile("me", { participant: "self" }, ctx))).toEqual({ showVideo: true, playAudio: false });
    expect(tilePlayback(resolveTile("t", { channels: ["audio"] }, ctx))).toEqual({ showVideo: false, playAudio: true });
  });
});

describe("recordingKinds", () => {
  it("starts once every listed kind is present", () => {
    expect(recordingKinds(["video", "audio"], ["audio", "video"], 0)).toEqual(["video", "audio"]);
    expect(recordingKinds(["video", "audio"], ["audio"], 0)).toBeNull();
  });

  it("after the grace period, records what has arrived", () => {
    expect(recordingKinds(["video", "audio"], ["audio"], RecordingStartGraceMs)).toEqual(["audio"]);
    expect(recordingKinds(["video"], [], RecordingStartGraceMs)).toBeNull();
  });
});
