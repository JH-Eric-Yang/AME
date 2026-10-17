import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import type { ElementConfig } from "ame-shared";
import type { NaturalSize } from "ame-shared/layout";
import {
  naturalSizes,
  measureNaturalSize,
  mediaUrl,
  resetNaturalSizes,
  type MediaKind,
} from "../naturalSize";

const image = (src?: string): ElementConfig => ({
  name: "img",
  type: "image",
  params: src === undefined ? {} : { src },
});

/** A loader that records what it was asked and answers on demand. */
function fakeLoader(answer: NaturalSize | null) {
  const calls: { url: string; kind: MediaKind }[] = [];
  const resolvers: ((s: NaturalSize | null) => void)[] = [];
  const load = (url: string, kind: MediaKind) => {
    calls.push({ url, kind });
    return new Promise<NaturalSize | null>((resolve) => resolvers.push(resolve));
  };
  const settle = async () => {
    resolvers.splice(0).forEach((r) => r(answer));
    await Promise.resolve();
  };
  return { load, calls, settle };
}

beforeEach(() => resetNaturalSizes());

describe("mediaUrl", () => {
  it("resolves an asset reference to a loadable URL", () => {
    expect(mediaUrl(image("asset:abc"))).toContain("/api/assets/abc");
  });

  it("passes an external URL through", () => {
    expect(mediaUrl(image("https://example.com/a.png"))).toBe("https://example.com/a.png");
  });

  /** A freshly dropped element has params: {} — there is nothing to measure. */
  it("has no URL for an element with no source yet", () => {
    expect(mediaUrl(image())).toBeNull();
    expect(mediaUrl(image(""))).toBeNull();
  });
});

describe("measureNaturalSize", () => {
  it("publishes a measured size under its URL", async () => {
    const loader = fakeLoader({ width: 800, height: 600 });
    measureNaturalSize("/a.png", "image", loader.load);
    await loader.settle();
    expect(get(naturalSizes)["/a.png"]).toEqual({ width: 800, height: 600 });
  });

  it("measures a URL once however often it is asked for", async () => {
    const loader = fakeLoader({ width: 800, height: 600 });
    measureNaturalSize("/a.png", "image", loader.load);
    measureNaturalSize("/a.png", "image", loader.load);
    await loader.settle();
    measureNaturalSize("/a.png", "image", loader.load);
    expect(loader.calls).toHaveLength(1);
  });

  /**
   * A missing asset answers 404 every time. Remembering the failure is what
   * keeps a canvas that re-renders on every drag out of a request loop.
   */
  it("does not retry media that never loads, and records the failure", async () => {
    const loader = fakeLoader(null);
    measureNaturalSize("/gone.png", "image", loader.load);
    await loader.settle();
    measureNaturalSize("/gone.png", "image", loader.load);
    expect(loader.calls).toHaveLength(1);
    // null, not absent: "cannot be measured" reads differently to a
    // researcher than "not measured yet", and both must be sayable.
    expect(get(naturalSizes)["/gone.png"]).toBeNull();
    expect("/never-asked.png" in get(naturalSizes)).toBe(false);
  });

  it("ignores an empty URL rather than loading the current page", () => {
    const loader = fakeLoader({ width: 1, height: 1 });
    measureNaturalSize("", "image", loader.load);
    expect(loader.calls).toHaveLength(0);
  });

  it("tells the loader which kind of medium it is measuring", () => {
    const loader = fakeLoader({ width: 640, height: 480 });
    measureNaturalSize("/clip.mp4", "video", loader.load);
    expect(loader.calls[0].kind).toBe("video");
  });
});
