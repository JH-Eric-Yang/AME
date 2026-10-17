import { describe, it, expect } from "vitest";
import type { ElementConfig } from "ame-shared";
import {
  DefaultChannels,
  tileParticipant,
  tileChannels,
  mediaChannels,
  hasTextChannel,
  isSelfTile,
  tileMirror,
  tileRecords,
  tileProducerKind,
  transcriptKey,
  transcriptOf,
  transcriptText,
  chatScope,
  chatKey,
  resolveVideoLayout,
} from "ame-shared/videoChat";
import { elementRefKind } from "ame-shared/producers";

describe("tile defaults", () => {
  it("an empty tile is a partner tile with video and audio", () => {
    expect(tileParticipant({})).toBe("partner");
    expect(tileChannels({})).toEqual(["video", "audio"]);
    expect(DefaultChannels).toEqual(["video", "audio"]);
    expect(isSelfTile({})).toBe(false);
    expect(tileMirror({})).toBe(false);
  });

  it("trims the participant and treats blank as the default", () => {
    expect(tileParticipant({ participant: "  seat:3 " })).toBe("seat:3");
    expect(tileParticipant({ participant: "   " })).toBe("partner");
  });

  it("a self tile mirrors by default and can opt out", () => {
    expect(isSelfTile({ participant: "self" })).toBe(true);
    expect(tileMirror({ participant: "self" })).toBe(true);
    expect(tileMirror({ participant: "self", mirror: false })).toBe(false);
  });

  it("keeps listed channels once each, drops unknown ones, and honours an explicit empty list", () => {
    expect(tileChannels({ channels: ["text", "audio", "text"] })).toEqual(["text", "audio"]);
    expect(tileChannels({ channels: ["video", "smell" as never] })).toEqual(["video"]);
    expect(tileChannels({ channels: [] })).toEqual([]);
  });

  it("separates media channels from text", () => {
    expect(mediaChannels({ channels: ["text", "audio"] })).toEqual(["audio"]);
    expect(hasTextChannel({ channels: ["text", "audio"] })).toBe(true);
    expect(hasTextChannel({})).toBe(false);
  });
});

describe("tile production", () => {
  it("records only when asked and a media channel is listed", () => {
    expect(tileRecords({ record: true })).toBe(true);
    expect(tileRecords({ record: true, channels: ["text"] })).toBe(false);
    expect(tileRecords({})).toBe(false);
  });

  it("a recorded tile produces media, a text tile a value, a plain tile nothing", () => {
    expect(tileProducerKind({ record: true })).toBe("media");
    expect(tileProducerKind({ channels: ["text"] })).toBe("value");
    expect(tileProducerKind({ record: true, channels: ["text", "audio"] })).toBe("media");
    expect(tileProducerKind({})).toBeNull();
  });

  it("stores the transcript under the element name unless the tile also records", () => {
    expect(transcriptKey("chat", { channels: ["text"] })).toBe("chat");
    expect(transcriptKey("chat", { record: true, channels: ["text", "video"] })).toBe("chat__transcript");
  });

  it("elementRefKind asks the tile for video-chat and the type otherwise", () => {
    const tile = (params: object) => ({ type: "video-chat", params }) as ElementConfig;
    expect(elementRefKind(tile({ channels: ["text"] }))).toBe("value");
    expect(elementRefKind(tile({ record: true }))).toBe("media");
    expect(elementRefKind(tile({}))).toBeNull();
    expect(elementRefKind({ type: "recorder", params: {} } as ElementConfig)).toBe("media");
    expect(elementRefKind({ type: "text", params: {} } as ElementConfig)).toBeNull();
  });
});

describe("transcripts and chat keys", () => {
  const lines = [
    { from: "p1", seat: 0, text: "hi", at: 10 },
    { from: "p2", seat: 1, text: "hello", at: 20 },
  ];

  it("drops the sender id from the stored transcript and joins text with newlines", () => {
    expect(transcriptOf(lines)).toEqual([
      { seat: 0, text: "hi", at: 10 },
      { seat: 1, text: "hello", at: 20 },
    ]);
    expect(transcriptText(transcriptOf(lines))).toBe("hi\nhello");
    expect(transcriptText([])).toBe("");
  });

  it("builds the scope and the Redis key from session, progress and group", () => {
    expect(chatScope(5, 2)).toBe("5:2");
    expect(chatKey("sess-1", 5, 2)).toBe("ame:chat:sess-1:5:2");
  });
});

describe("video layout", () => {
  it("keeps the automatic panel when the routine has no choice", () => {
    expect(resolveVideoLayout(undefined)).toBe("auto");
    expect(resolveVideoLayout(null)).toBe("auto");
    expect(resolveVideoLayout({})).toBe("auto");
  });

  it("uses the custom layout only when the routine asks for it", () => {
    expect(resolveVideoLayout({ videoLayout: "custom" })).toBe("custom");
    expect(resolveVideoLayout({ videoLayout: "auto" })).toBe("auto");
  });
});
