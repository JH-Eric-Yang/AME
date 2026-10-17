import { describe, it, expect } from "vitest";
import type { RoutineConfig } from "ame-shared";
import { parseRef } from "ame-shared/refs";
import { producersOf, consumersOf, describeRef } from "../progressSummary";

const routine: RoutineConfig = {
  name: "recap", type: "routine-card", layout: { rows: [] },
  elements: [
    { name: "replay", type: "video", params: { src: "ref:self/p0/clip" } },
    { name: "name", type: "input-textfield", params: {} },
    { name: "rec", type: "recorder", params: {} },
    { name: "text", type: "text", params: { content: "{{ref:self/p0/name}} {{ref:self/p0/name}}" } },
  ],
};

describe("producersOf", () => {
  it("lists data-producing elements with their kind, in routine order", () => {
    expect(producersOf(routine)).toEqual([
      { element: "name", type: "input-textfield", kind: "value" },
      { element: "rec", type: "recorder", kind: "media" },
    ]);
  });
});

describe("producersOf — video-chat tiles", () => {
  it("lists a recorded tile as media, a text tile as a value, and skips a plain tile", () => {
    const tiles: RoutineConfig = {
      name: "chat", type: "routine-card", layout: { rows: [] },
      elements: [
        { name: "cam", type: "video-chat", params: { record: true } },
        { name: "thread", type: "video-chat", params: { channels: ["text"] } },
        { name: "plain", type: "video-chat", params: {} },
      ],
    };
    expect(producersOf(tiles)).toEqual([
      { element: "cam", type: "video-chat", kind: "media" },
      { element: "thread", type: "video-chat", kind: "value" },
    ]);
  });

  it("lists a recorded text tile's transcript after its recording", () => {
    const tiles: RoutineConfig = {
      name: "chat", type: "routine-card", layout: { rows: [] },
      elements: [{ name: "talk", type: "video-chat", params: { record: true, channels: ["audio", "text"] } }],
    };
    expect(producersOf(tiles)).toEqual([
      { element: "talk", type: "video-chat", kind: "media" },
      { element: "talk__transcript", type: "video-chat", kind: "value" },
    ]);
  });
});

describe("consumersOf", () => {
  it("lists each distinct ref per element, overrides included", () => {
    const out = consumersOf(routine, { name: { placeholder: "{{ref:partner/t2/rec.uploadId}}" } });
    expect(out.map((c) => [c.element, c.ref])).toEqual([
      ["replay", "ref:self/p0/clip"],
      ["name", "ref:partner/t2/rec.uploadId"],
      ["text", "ref:self/p0/name"],
    ]);
    expect(out[1].parsed?.field).toBe("uploadId");
  });
});

describe("describeRef", () => {
  it("renders who / where / element.field", () => {
    expect(describeRef(parseRef("ref:partner/t2/rec")!)).toBe("partner / t2 / rec");
    expect(describeRef(parseRef("ref:self/p0/survey-1.q1")!)).toBe("self / p0 / survey-1.q1");
    expect(describeRef(parseRef("ref:seat:3/t2:chat/rec")!)).toBe("seat:3 / t2:chat / rec");
  });
});
