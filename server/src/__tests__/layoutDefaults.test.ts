import { describe, it, expect } from "vitest";
import type { ElementConfig, RoutineLayout, RoutineType } from "ame-shared";
import {
  assign,
  defaultCellAlign,
  defaultPadding,
  isCardFamily,
  resolvedLayout,
  seedPlacements,
  supportsStage,
  stageUnavailableReason,
  overlaps,
  CardGridPadding,
  DefaultPadding,
} from "ame-shared/layout";

const AllRoutineTypes: RoutineType[] = [
  "routine-borderless",
  "routine-card",
  "routine-consent",
  "routine-end",
  "routine-end-matching",
  "routine-matching",
  "routine-pos-check",
  "routine-survey",
  "routine-video-chat",
];

describe("defaultCellAlign", () => {
  it("centres a borderless routine's elements: no card gives them a width", () => {
    expect(defaultCellAlign("routine-borderless")).toBe("center");
  });

  it("stretches every other routine type", () => {
    for (const type of AllRoutineTypes) {
      if (type === "routine-borderless") continue;
      expect(defaultCellAlign(type)).toBe("stretch");
    }
  });

  it("stretches when the routine type is not yet known", () => {
    expect(defaultCellAlign(undefined)).toBe("stretch");
  });
});

describe("isCardFamily", () => {
  it("names the four routines that wrap their grid in a card", () => {
    expect(AllRoutineTypes.filter(isCardFamily)).toEqual([
      "routine-card",
      "routine-consent",
      "routine-end",
      "routine-survey",
    ]);
  });

  it("is false when the routine type is not yet known", () => {
    expect(isCardFamily(undefined)).toBe(false);
  });
});

describe("supportsStage", () => {
  it("names only the routine whose surface IS the stage", () => {
    expect(AllRoutineTypes.filter(supportsStage)).toEqual(["routine-borderless"]);
  });
});

describe("stageUnavailableReason", () => {
  it("is null exactly where a stage is supported", () => {
    for (const type of AllRoutineTypes) {
      expect(stageUnavailableReason(type) === null).toBe(supportsStage(type));
    }
  });

  it("says the routine has no elements to place, for the matching routines", () => {
    for (const type of ["routine-matching", "routine-end-matching"] as RoutineType[]) {
      expect(stageUnavailableReason(type)).toMatch(/renders no authored elements/);
    }
  });

  it("says the routine owns the surface, for every other unsupported type", () => {
    for (const type of AllRoutineTypes) {
      if (supportsStage(type)) continue;
      if (type === "routine-matching" || type === "routine-end-matching") continue;
      expect(stageUnavailableReason(type)).toMatch(/inside its own chrome/);
    }
  });
});

describe("defaultPadding", () => {
  it("gives a card-family grid none of its own: the card already has padding", () => {
    expect(defaultPadding("routine-card")).toBe(CardGridPadding);
    expect(defaultPadding("routine-survey")).toBe(CardGridPadding);
  });

  it("gives every other routine the container default", () => {
    expect(defaultPadding("routine-borderless")).toBe(DefaultPadding);
    expect(defaultPadding("routine-video-chat")).toBe(DefaultPadding);
  });
});

describe("resolvedLayout", () => {
  it("zeroes a card-family grid's padding: the card supplies its own", () => {
    const layout: RoutineLayout = { rows: [] };
    expect(resolvedLayout(layout, "routine-card").padding).toBe(CardGridPadding);
    expect(resolvedLayout(layout, "routine-end").padding).toBe(CardGridPadding);
  });

  it("leaves an authored padding alone, whatever the routine type", () => {
    const layout: RoutineLayout = { rows: [], padding: "2rem" };
    expect(resolvedLayout(layout, "routine-card").padding).toBe("2rem");
    expect(resolvedLayout(layout, "routine-borderless").padding).toBe("2rem");
  });

  it("fills in the container default for every other routine type", () => {
    expect(resolvedLayout({ rows: [] }, "routine-video-chat").padding).toBe(DefaultPadding);
  });

  it("copies rather than mutating: the authored layout is shared state", () => {
    const layout: RoutineLayout = { rows: [{ columns: [{ span: 12 }] }] };
    const resolved = resolvedLayout(layout, "routine-card");
    expect(layout.padding).toBeUndefined();
    expect(resolved.rows).toBe(layout.rows);
  });
});

describe("seedPlacements", () => {
  const layout: RoutineLayout = {
    rows: [
      { columns: [{ span: 6 }, { span: 6 }] },
      { columns: [{ span: 12 }] },
    ],
  };
  const el = (name: string, row: number, column: number): ElementConfig => ({
    name, type: "text", params: { content: name }, position: { row, column },
  });

  it("gives each element the rectangle its flow cell occupied", () => {
    const seeds = seedPlacements([el("a", 0, 0), el("b", 0, 1)], layout);
    const a = seeds.get("a");
    const b = seeds.get("b");
    expect(a?.xPct).toBeCloseTo(0, 3);
    expect(a?.wPct).toBeCloseTo(50, 3);
    expect(b?.xPct).toBeCloseTo(50, 3);
    expect(b?.wPct).toBeCloseTo(50, 3);
    // Two rows, so each row takes half the stage height.
    expect(a?.yPct).toBeCloseTo(0, 3);
    expect(a?.hPct).toBeCloseTo(50, 3);
  });

  it("puts a second row below the first", () => {
    const seeds = seedPlacements([el("c", 1, 0)], layout);
    expect(seeds.get("c")?.yPct).toBeCloseTo(50, 3);
    expect(seeds.get("c")?.wPct).toBeCloseTo(100, 3);
  });

  it("never seeds two elements into overlapping boxes", () => {
    const seeds = seedPlacements(
      [el("a", 0, 0), el("b", 0, 1), el("c", 1, 0)],
      layout,
    );
    const all = [...seeds.values()];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(overlaps(all[i], all[j])).toBe(false);
      }
    }
  });

  it("stacks elements that shared a cell rather than overlapping them", () => {
    const seeds = seedPlacements([el("a", 0, 0), el("b", 0, 0)], layout);
    expect(overlaps(seeds.get("a")!, seeds.get("b")!)).toBe(false);
  });

  it("skips an element with no position", () => {
    const loose: ElementConfig = { name: "loose", type: "text", params: { content: "x" } };
    expect(seedPlacements([loose], layout).has("loose")).toBe(false);
  });

  /**
   * Out-of-range positions are reachable (see positionInRange). Deriving a
   * rectangle from one puts the element off the stage, where nothing renders
   * it and no strip lists it — so it must not be seeded at all, leaving
   * assign() to route it to `unplaced` where the researcher can see it.
   */
  describe("an element whose position names a cell the layout does not have", () => {
    const oneColumnRow: RoutineLayout = { rows: [{ columns: [{ span: 12 }] }] };

    it("is skipped when its column is past the row's columns", () => {
      // Would seed { xPct: 100, wPct: 100 }: entirely right of the stage.
      const seeds = seedPlacements([el("retyped", 0, 1)], oneColumnRow);
      expect(seeds.has("retyped")).toBe(false);
    });

    it("is skipped when the layout has no rows at all", () => {
      // Would seed { yPct: 100 }: entirely below the stage.
      const seeds = seedPlacements([el("orphan", 1, 0)], { rows: [] });
      expect(seeds.has("orphan")).toBe(false);
    });

    it("is skipped when its row is past the layout's rows", () => {
      // Would seed { yPct: 150 } against this two-row layout.
      const seeds = seedPlacements([el("below", 3, 0)], layout);
      expect(seeds.has("below")).toBe(false);
    });

    it("still seeds the in-range elements beside it", () => {
      const seeds = seedPlacements([el("a", 0, 0), el("below", 3, 0)], layout);
      expect(seeds.get("a")?.yPct).toBeCloseTo(0, 3);
      expect(seeds.has("below")).toBe(false);
    });

    it("seeds exactly the elements assign() would render into a cell", () => {
      const elements = [el("a", 0, 0), el("retyped", 0, 5), el("below", 9, 0)];
      const seeds = seedPlacements(elements, layout);
      const placed = assign(elements, layout);
      const inCells = [...placed.cells.values()]
        .flat()
        .map((p) => p.element.name)
        .sort();
      expect([...seeds.keys()].sort()).toEqual(inCells);
    });
  });
});
