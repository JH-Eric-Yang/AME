import { describe, it, expect } from "vitest";
import type { RoutineLayout } from "ame-shared";
import {
  styleString,
  containerStyle,
  rowStyle,
  cellStyle,
  looseCellStyle,
} from "ame-shared/layout";

describe("styleString", () => {
  it("joins a style map into a CSS declaration list", () => {
    expect(styleString({ display: "flex", gap: "1rem" })).toBe("display: flex; gap: 1rem");
  });

  it("returns an empty string for an empty map", () => {
    expect(styleString({})).toBe("");
  });
});

describe("containerStyle", () => {
  it("applies the runtime defaults when the layout says nothing", () => {
    const layout: RoutineLayout = { rows: [] };
    expect(containerStyle(layout)).toEqual({
      display: "flex",
      "flex-direction": "column",
      gap: "1rem",
      padding: "1rem",
      "align-items": "stretch",
      "justify-content": "flex-start",
    });
  });

  it("applies justifyContent, which the builder canvas used to ignore", () => {
    const layout: RoutineLayout = { rows: [], justifyContent: "between" };
    expect(containerStyle(layout)["justify-content"]).toBe("space-between");
  });

  it("passes gap, padding and alignItems through", () => {
    const layout: RoutineLayout = {
      rows: [],
      gap: "2rem",
      padding: "0",
      alignItems: "center",
    };
    const s = containerStyle(layout);
    expect(s.gap).toBe("2rem");
    expect(s.padding).toBe("0");
    expect(s["align-items"]).toBe("center");
  });
});

describe("rowStyle", () => {
  it("maps the shorthand justify values onto CSS", () => {
    expect(rowStyle({ columns: [], justify: "between" })["justify-content"]).toBe(
      "space-between",
    );
    expect(rowStyle({ columns: [], justify: "around" })["justify-content"]).toBe(
      "space-around",
    );
    expect(rowStyle({ columns: [], justify: "center" })["justify-content"]).toBe("center");
  });

  it("defaults to flex-start", () => {
    expect(rowStyle({ columns: [] })["justify-content"]).toBe("flex-start");
  });
});

describe("cellStyle", () => {
  it("turns a span into a twelfth-based flex basis", () => {
    expect(cellStyle({ span: 6 })).toEqual({
      display: "flex",
      "flex-direction": "column",
      gap: "0.5rem",
      "box-sizing": "border-box",
      flex: "0 0 calc(6 / 12 * 100%)",
      "max-width": "calc(6 / 12 * 100%)",
      "align-items": "stretch",
    });
  });

  it("gives a full-width column the whole row", () => {
    const s = cellStyle({ span: 12 });
    expect(s.flex).toBe("0 0 calc(12 / 12 * 100%)");
    expect(s["max-width"]).toBe("calc(12 / 12 * 100%)");
  });

  it("defaults align-items to stretch when no cellAlign is given, matching every layout authored before the field existed", () => {
    expect(cellStyle({ span: 6 })["align-items"]).toBe("stretch");
    expect(cellStyle({ span: 6 }, undefined)["align-items"]).toBe("stretch");
  });

  it("emits an explicit cellAlign as align-items", () => {
    expect(cellStyle({ span: 6 }, "center")["align-items"]).toBe("center");
    expect(cellStyle({ span: 6 }, "start")["align-items"]).toBe("start");
    expect(cellStyle({ span: 6 }, "end")["align-items"]).toBe("end");
  });
});

describe("looseCellStyle", () => {
  it("aligns an element that has no cell of its own the way a cell would", () => {
    expect(looseCellStyle("center")).toEqual({
      display: "flex",
      "flex-direction": "column",
      gap: "0.5rem",
      "align-items": "center",
    });
  });

  it("carries no flex basis: it is already a full-width child of the container", () => {
    expect(looseCellStyle("stretch")).not.toHaveProperty("flex");
    expect(looseCellStyle("stretch")).not.toHaveProperty("max-width");
  });

  it("stacks with the same gap a cell uses, so unplaced elements read as one column", () => {
    expect(looseCellStyle("stretch").gap).toBe(cellStyle({ span: 12 }).gap);
  });
});
