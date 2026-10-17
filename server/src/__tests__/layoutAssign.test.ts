import { describe, it, expect } from "vitest";
import type {
  ElementConfig,
  ElementType,
  ElementParams,
  RoutineLayout,
} from "ame-shared";
import { assign, cellKey, elementsInCell } from "ame-shared/layout";

/** A layout wide enough for every coordinate these tests use. */
const Bench: RoutineLayout = {
  rows: Array.from({ length: 6 }, () => ({
    columns: Array.from({ length: 6 }, () => ({ span: 2 })),
  })),
};

function el(
  name: string,
  position?: { row: number; column: number; order?: number },
  type: ElementType = "text",
  params: Partial<ElementParams> = {},
): ElementConfig {
  return { name, type, params: params as ElementParams, position };
}

describe("assign", () => {
  it("buckets elements by their cell", () => {
    const elements = [
      el("a", { row: 0, column: 0 }),
      el("b", { row: 0, column: 1 }),
      el("c", { row: 1, column: 0 }),
    ];
    const result = assign(elements, Bench);
    expect(elementsInCell(result, 0, 0).map((p) => p.element.name)).toEqual(["a"]);
    expect(elementsInCell(result, 0, 1).map((p) => p.element.name)).toEqual(["b"]);
    expect(elementsInCell(result, 1, 0).map((p) => p.element.name)).toEqual(["c"]);
  });

  it("returns an empty list for a cell nothing was placed in", () => {
    expect(elementsInCell(assign([], Bench), 3, 4)).toEqual([]);
  });

  it("pairs each element with its OWN index even when order disagrees with array position", () => {
    // The regression from commit 2bcd170. Indices 3 and 7 share a cell, but
    // their declared order reverses them. Sorting elements without carrying
    // their indices pairs el7 with index 3 and el3 with index 7.
    const elements: ElementConfig[] = [
      el("other-a", { row: 5, column: 5 }),
      el("other-b", { row: 5, column: 5 }),
      el("other-c", { row: 5, column: 5 }),
      el("el3", { row: 0, column: 0, order: 1 }),
      el("other-d", { row: 5, column: 5 }),
      el("other-e", { row: 5, column: 5 }),
      el("other-f", { row: 5, column: 5 }),
      el("el7", { row: 0, column: 0, order: 0 }),
    ];

    const placed = elementsInCell(assign(elements, Bench), 0, 0);

    expect(placed.map((p) => p.element.name)).toEqual(["el7", "el3"]);
    expect(placed.map((p) => p.index)).toEqual([7, 3]);

    // The load-bearing property: every pair describes one source element.
    placed.forEach((p) => {
      expect(elements[p.index]).toBe(p.element);
    });
  });

  it("treats a missing order as 0", () => {
    const elements = [
      el("second", { row: 0, column: 0, order: 1 }),
      el("first", { row: 0, column: 0 }),
    ];
    expect(elementsInCell(assign(elements, Bench), 0, 0).map((p) => p.element.name)).toEqual([
      "first",
      "second",
    ]);
  });

  it("routes weightless elements to background, wherever they were placed", () => {
    const elements = [
      el("watcher", { row: 0, column: 0 }, "body-detector"),
      el("keys", { row: 0, column: 0 }, "keyboard"),
      el("prompt", { row: 0, column: 0 }),
    ];
    const result = assign(elements, Bench);
    expect(result.background.map((p) => p.element.name)).toEqual(["watcher", "keys"]);
    expect(elementsInCell(result, 0, 0).map((p) => p.element.name)).toEqual(["prompt"]);
  });

  it("keeps a detector in the grid once its overlay is shown", () => {
    const elements = [
      el("watcher", { row: 0, column: 0 }, "body-detector", { showOverlay: true }),
    ];
    const result = assign(elements, Bench);
    expect(result.background).toEqual([]);
    expect(elementsInCell(result, 0, 0).map((p) => p.element.name)).toEqual(["watcher"]);
  });

  it("collects positionless elements in unplaced rather than dropping them", () => {
    // The seeded-experiment case: e2e/fixtures/seed.ts omits position entirely.
    const elements = [el("a"), el("b", { row: 0, column: 0 }), el("c")];
    const result = assign(elements, Bench);
    expect(result.unplaced.map((p) => p.element.name)).toEqual(["a", "c"]);
    expect(result.unplaced.map((p) => p.index)).toEqual([0, 2]);
  });

  it("treats a row beyond the layout as unplaced rather than an unreadable cell", () => {
    // Removing a row is handled by CanvasBuilder, but nothing stops a layout
    // arriving with fewer rows than an element's position names.
    const layout: RoutineLayout = { rows: [{ columns: [{ span: 12 }] }] };
    const elements = [el("stranded", { row: 3, column: 0 }), el("here", { row: 0, column: 0 })];
    const result = assign(elements, layout);
    expect(result.unplaced.map((p) => p.element.name)).toEqual(["stranded"]);
    expect(elementsInCell(result, 0, 0).map((p) => p.element.name)).toEqual(["here"]);
  });

  it("treats a column beyond its row as unplaced", () => {
    // The reachable case: retyping a 6:6 row as a single 12 in CanvasToolbar
    // leaves everything in column 1 pointing at a cell that no longer exists.
    const layout: RoutineLayout = { rows: [{ columns: [{ span: 12 }] }] };
    const elements = [el("left", { row: 0, column: 0 }), el("right", { row: 0, column: 1 })];
    const result = assign(elements, layout);
    expect(result.unplaced.map((p) => p.element.name)).toEqual(["right"]);
    expect(elementsInCell(result, 0, 0).map((p) => p.element.name)).toEqual(["left"]);
  });

  it("treats a negative coordinate as unplaced", () => {
    const layout: RoutineLayout = { rows: [{ columns: [{ span: 12 }] }] };
    const result = assign([el("odd", { row: -1, column: 0 }), el("odder", { row: 0, column: -1 })], layout);
    expect(result.unplaced.map((p) => p.element.name)).toEqual(["odd", "odder"]);
  });

  it("still routes an out-of-range weightless element to background, not unplaced", () => {
    // Background elements have no box to lose, so a stale coordinate is
    // irrelevant to them — they must keep mounting and recording.
    const layout: RoutineLayout = { rows: [{ columns: [{ span: 12 }] }] };
    const result = assign([el("keys", { row: 9, column: 9 }, "keyboard")], layout);
    expect(result.background.map((p) => p.element.name)).toEqual(["keys"]);
    expect(result.unplaced).toEqual([]);
  });

  it("prefers background over unplaced for a weightless element with no position", () => {
    const result = assign([el("keys", undefined, "keyboard")], Bench);
    expect(result.background.map((p) => p.element.name)).toEqual(["keys"]);
    expect(result.unplaced).toEqual([]);
  });

  it("applies the include filter and still reports original indices", () => {
    const elements = [
      el("mine", { row: 0, column: 0 }),
      el("theirs", { row: 0, column: 0 }),
      el("also-mine", { row: 0, column: 0 }),
    ];
    const result = assign(elements, Bench, {
      include: (e) => e.name !== "theirs",
    });
    const placed = elementsInCell(result, 0, 0);
    expect(placed.map((p) => p.element.name)).toEqual(["mine", "also-mine"]);
    expect(placed.map((p) => p.index)).toEqual([0, 2]);
  });
});

describe("assign in free mode", () => {
  const FreeLayout: RoutineLayout = { ...Bench, mode: "free" };

  it("routes a free-mode element with a placement to the free bucket, not a cell", () => {
    const placed: ElementConfig = {
      ...el("a", { row: 0, column: 0 }),
      placement: { xPct: 10, yPct: 10, wPct: 30, hPct: 20 },
    };
    const result = assign([placed], FreeLayout);
    expect(result.free.map((p) => p.element.name)).toEqual(["a"]);
    expect(result.cells.size).toBe(0);
    expect(result.unplaced).toEqual([]);
  });

  it("routes a free-mode element with no placement to unplaced, never dropping it", () => {
    // The free-mode analogue of a missing `position` in flow mode.
    const loose = el("loose", { row: 0, column: 0 });
    const result = assign([loose], FreeLayout);
    expect(result.free).toEqual([]);
    expect(result.unplaced.map((p) => p.element.name)).toEqual(["loose"]);
  });

  it("still routes a weightless element to background ahead of free/unplaced", () => {
    const keys = el("keys", undefined, "keyboard");
    const result = assign([keys], FreeLayout);
    expect(result.background.map((p) => p.element.name)).toEqual(["keys"]);
    expect(result.free).toEqual([]);
    expect(result.unplaced).toEqual([]);
  });

  it("leaves free empty for a flow-mode layout", () => {
    const placed: ElementConfig = {
      ...el("a", { row: 0, column: 0 }),
      placement: { xPct: 10, yPct: 10, wPct: 30, hPct: 20 },
    };
    // Bench has no `mode`, so this is ordinary flow: the placement is ignored.
    const result = assign([placed], Bench);
    expect(result.free).toEqual([]);
    expect(elementsInCell(result, 0, 0).map((p) => p.element.name)).toEqual(["a"]);
  });
});

describe("cellKey", () => {
  it("is unique per row and column", () => {
    expect(cellKey(0, 1)).not.toBe(cellKey(1, 0));
  });
});
