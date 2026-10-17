import { describe, it, expect } from "vitest";
import { toggleChannel } from "../videoChatParams";

describe("toggleChannel", () => {
  it("adds a channel in canonical order", () => {
    expect(toggleChannel(["text"], "video", true)).toEqual(["video", "text"]);
    expect(toggleChannel(["video", "audio"], "text", true)).toEqual(["video", "audio", "text"]);
  });

  it("removes a channel and can leave the list empty", () => {
    expect(toggleChannel(["video", "audio"], "video", false)).toEqual(["audio"]);
    expect(toggleChannel(["audio"], "audio", false)).toEqual([]);
  });

  it("is idempotent", () => {
    expect(toggleChannel(["audio"], "audio", true)).toEqual(["audio"]);
    expect(toggleChannel(["audio"], "video", false)).toEqual(["audio"]);
  });
});
