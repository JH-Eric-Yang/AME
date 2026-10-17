import { describe, it, expect } from "vitest";
import type { ElementConfig, RoutineLayout } from "ame-shared";
import { applyLayoutMode, DefaultFreeStage } from "ame-shared/layout";

const layout: RoutineLayout = {
  rows: [{ columns: [{ span: 6 }, { span: 6 }] }, { columns: [{ span: 12 }] }],
};

const el = (name: string, row: number, column: number): ElementConfig => ({
  name,
  type: "text",
  params: { content: name },
  position: { row, column },
});

describe("applyLayoutMode", () => {
  describe("flow -> free", () => {
    it("locks a stage when the routine was fluid", () => {
      const result = applyLayoutMode(layout, [el("a", 0, 0)], "free");
      expect(result.layout.mode).toBe("free");
      expect(result.layout.stage).toBe(DefaultFreeStage);
      expect(result.stageLocked).toBe(true);
    });

    it("locks a stage when the routine named no stage at all", () => {
      const noStage: RoutineLayout = { rows: layout.rows };
      const result = applyLayoutMode(noStage, [el("a", 0, 0)], "free");
      expect(result.layout.stage).toBe(DefaultFreeStage);
      expect(result.stageLocked).toBe(true);
    });

    it("keeps an already-locked stage untouched", () => {
      const locked: RoutineLayout = { ...layout, stage: "4:3" };
      const result = applyLayoutMode(locked, [el("a", 0, 0)], "free");
      expect(result.layout.stage).toBe("4:3");
      expect(result.stageLocked).toBe(false);
    });

    it("seeds a placement for every element missing one", () => {
      const result = applyLayoutMode(layout, [el("a", 0, 0), el("b", 0, 1)], "free");
      const a = result.elements.find((e) => e.name === "a");
      const b = result.elements.find((e) => e.name === "b");
      expect(a?.placement).toEqual({ xPct: 0, yPct: 0, wPct: 50, hPct: 50 });
      expect(b?.placement?.xPct).toBeCloseTo(50, 3);
    });

    it("leaves an element that already has a placement untouched", () => {
      const hand: ElementConfig = {
        ...el("a", 0, 0),
        placement: { xPct: 12, yPct: 34, wPct: 20, hPct: 10 },
      };
      const result = applyLayoutMode(layout, [hand], "free");
      expect(result.elements[0].placement).toEqual({ xPct: 12, yPct: 34, wPct: 20, hPct: 10 });
    });

    it("does not seed an element with no flow position", () => {
      const loose: ElementConfig = { name: "loose", type: "text", params: { content: "x" } };
      const result = applyLayoutMode(layout, [loose], "free");
      expect(result.elements[0].placement).toBeUndefined();
    });

    /**
     * applyLayoutMode commits whatever seedPlacements returns, unclamped, and
     * assign() routes anything carrying a placement into the `free` bucket
     * rather than `unplaced` — so a seed off the stage would render nowhere
     * and be listed nowhere. The three shapes below are the reachable ones.
     */
    it("commits no placement that would put an element off the stage", () => {
      const offStage = [
        // Column 2 of a row since retyped to one column.
        { layout: { rows: [{ columns: [{ span: 12 }] }] } as RoutineLayout, el: el("a", 0, 1) },
        // Every row removed underneath it.
        { layout: { rows: [] } as RoutineLayout, el: el("b", 1, 0) },
        // Row 3 of a two-row layout.
        { layout, el: el("c", 3, 0) },
      ];

      for (const { layout: l, el: element } of offStage) {
        const result = applyLayoutMode(l, [element], "free");
        // No placement at all: assign() then lists it as "not placed", which
        // is where a researcher can see and recover it.
        expect(result.elements[0].placement).toBeUndefined();
      }
    });

    it("does not mutate the input layout or elements", () => {
      const original = [el("a", 0, 0)];
      const originalLayout = { ...layout };
      applyLayoutMode(layout, original, "free");
      expect(layout).toEqual(originalLayout);
      expect(original[0].placement).toBeUndefined();
    });
  });

  describe("free -> flow", () => {
    it("changes only mode, leaving stage and placements as authored", () => {
      const free: RoutineLayout = { ...layout, mode: "free", stage: "4:3" };
      const withPlacement: ElementConfig = {
        ...el("a", 0, 0),
        placement: { xPct: 12, yPct: 34, wPct: 20, hPct: 10 },
      };
      const result = applyLayoutMode(free, [withPlacement], "flow");
      expect(result.layout.mode).toBe("flow");
      expect(result.layout.stage).toBe("4:3");
      expect(result.stageLocked).toBe(false);
      expect(result.elements[0].placement).toEqual({ xPct: 12, yPct: 34, wPct: 20, hPct: 10 });
    });
  });
});
