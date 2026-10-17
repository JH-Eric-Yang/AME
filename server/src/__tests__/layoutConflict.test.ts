import { describe, it, expect } from "vitest";
import type { ElementConfig, FreePlacement } from "ame-shared";
import { neighbourPlacements, firstOverlap } from "ame-shared/layout";

const at = (xPct: number, yPct: number, wPct = 20, hPct = 10): FreePlacement => ({
  xPct,
  yPct,
  wPct,
  hPct,
});

const text = (name: string, placement?: FreePlacement): ElementConfig => ({
  name,
  type: "text",
  params: { content: name },
  placement,
});

describe("neighbourPlacements", () => {
  it("gives every other placed element, by name", () => {
    const elements = [text("a", at(0, 0)), text("b", at(50, 0)), text("c", at(0, 50))];
    expect(neighbourPlacements(elements, 1)).toEqual([
      { name: "a", placement: at(0, 0) },
      { name: "c", placement: at(0, 50) },
    ]);
  });

  it("skips the element being placed", () => {
    const elements = [text("a", at(0, 0)), text("b", at(50, 0))];
    expect(neighbourPlacements(elements, 0).map((n) => n.name)).toEqual(["b"]);
  });

  it("takes every element when nothing is being placed yet — a fresh drop", () => {
    const elements = [text("a", at(0, 0)), text("b", at(50, 0))];
    expect(neighbourPlacements(elements, null)).toHaveLength(2);
  });

  it("skips an element with no placement of its own", () => {
    expect(neighbourPlacements([text("a"), text("b", at(0, 0))], null).map((n) => n.name)).toEqual([
      "b",
    ]);
  });

  it("skips an element with no visual footprint: §6.1 exempts them", () => {
    // A body detector with no overlay is clip-path hidden and takes no space.
    const detector: ElementConfig = {
      name: "detector",
      type: "body-detector",
      params: {},
      placement: at(0, 0),
    };
    expect(neighbourPlacements([detector, text("b", at(50, 0))], null).map((n) => n.name)).toEqual([
      "b",
    ]);
  });

  it("honours the include predicate, so one audience does not block another", () => {
    const elements = [text("other-role", at(0, 0)), text("mine", at(50, 0))];
    const include = (el: ElementConfig) => el.name !== "other-role";
    expect(neighbourPlacements(elements, null, include).map((n) => n.name)).toEqual(["mine"]);
  });
});

describe("firstOverlap", () => {
  const neighbours = neighbourPlacements([text("a", at(0, 0, 30, 30)), text("b", at(60, 60))], null);

  it("names the element in the way", () => {
    expect(firstOverlap(at(10, 10), neighbours)?.name).toBe("a");
    expect(firstOverlap(at(65, 62), neighbours)?.name).toBe("b");
  });

  it("is null for a placement that is clear of everything", () => {
    expect(firstOverlap(at(35, 0), neighbours)).toBeNull();
  });

  it("is null for a placement merely flush against a neighbour", () => {
    // Edge snapping puts boxes flush on purpose; flush must stay legal.
    expect(firstOverlap(at(30, 0, 20, 30), neighbours)).toBeNull();
  });

  it("is null when there are no neighbours at all", () => {
    expect(firstOverlap(at(10, 10), [])).toBeNull();
  });
});
