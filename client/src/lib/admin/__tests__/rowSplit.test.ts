import { describe, it, expect } from "vitest";
import type { ElementConfig, GridRow } from "ame-shared";
import { canSplitRow, splitRowColumns, canRemoveColumn, removeColumn } from "../rowSplit";

describe("canSplitRow", () => {
  it("allows splitting a full-width single column", () => {
    const row: GridRow = { columns: [{ span: 12 }] };
    expect(canSplitRow(row)).toBe(true);
  });

  it("allows splitting three even columns that already sum to 12", () => {
    const row: GridRow = { columns: [{ span: 4 }, { span: 4 }, { span: 4 }] };
    expect(canSplitRow(row)).toBe(true);
  });

  it("refuses a single span-1 column — nothing left to give a second column", () => {
    const row: GridRow = { columns: [{ span: 1 }] };
    expect(canSplitRow(row)).toBe(false);
  });

  it("refuses twelve span-1 columns — the maximum sensible number", () => {
    const row: GridRow = { columns: Array.from({ length: 12 }, () => ({ span: 1 })) };
    expect(canSplitRow(row)).toBe(false);
  });

  it("refuses when the total is already too small for one more column", () => {
    const row: GridRow = { columns: [{ span: 1 }, { span: 1 }, { span: 1 }, { span: 1 }] };
    expect(canSplitRow(row)).toBe(false);
  });
});

describe("splitRowColumns", () => {
  it("halves a full-width single column", () => {
    const row: GridRow = { columns: [{ span: 12 }] };
    expect(splitRowColumns(row)).toEqual([{ span: 6 }, { span: 6 }]);
  });

  it("redivides three even columns into four even ones", () => {
    const row: GridRow = { columns: [{ span: 4 }, { span: 4 }, { span: 4 }] };
    expect(splitRowColumns(row)).toEqual([{ span: 3 }, { span: 3 }, { span: 3 }, { span: 3 }]);
  });

  it("keeps the row's existing (narrower) total rather than growing to 12", () => {
    const row: GridRow = { columns: [{ span: 3 }, { span: 2 }] };
    const result = splitRowColumns(row);
    expect(result.reduce((sum, c) => sum + c.span, 0)).toBe(5);
    expect(result).toEqual([{ span: 2 }, { span: 2 }, { span: 1 }]);
  });

  it("gives the remainder to the earliest columns", () => {
    const row: GridRow = { columns: [{ span: 4 }, { span: 4 }, { span: 4 }, { span: 4 }] };
    // total 16 is unrealistic under parseColumnSpans, but the arithmetic
    // itself should still favour early columns with any remainder.
    const result = splitRowColumns(row);
    expect(result).toEqual([{ span: 4 }, { span: 3 }, { span: 3 }, { span: 3 }, { span: 3 }]);
  });
});

describe("canRemoveColumn", () => {
  it("allows removal only when the row keeps at least one column", () => {
    expect(canRemoveColumn({ columns: [{ span: 6 }, { span: 6 }] })).toBe(true);
    expect(canRemoveColumn({ columns: [{ span: 12 }] })).toBe(false);
  });
});

describe("removeColumn", () => {
  const at = (row: number, column: number, order?: number) => ({ row, column, ...(order === undefined ? {} : { order }) });
  const el = (name: string, position?: ElementConfig["position"]): ElementConfig =>
    ({ name, type: "text", params: {}, ...(position ? { position } : {}) }) as ElementConfig;
  const row: GridRow = { columns: [{ span: 4 }, { span: 4 }, { span: 4 }] };

  it("gives the removed span to the column on its left", () => {
    expect(removeColumn(row, 1, 2, []).columns).toEqual([{ span: 4 }, { span: 8 }]);
  });

  it("gives the first column's span to the column on its right", () => {
    expect(removeColumn(row, 1, 0, []).columns).toEqual([{ span: 8 }, { span: 4 }]);
  });

  it("moves the removed column's elements after the target's, keeping their order", () => {
    const elements = [el("a", at(1, 0, 0)), el("b", at(1, 1, 1)), el("c", at(1, 1, 0)), el("d", at(1, 0, 1))];
    const out = removeColumn(row, 1, 1, elements).elements;
    expect(out.map((e) => [e.name, e.position])).toEqual([
      ["a", at(1, 0, 0)],
      ["b", at(1, 0, 3)],
      ["c", at(1, 0, 2)],
      ["d", at(1, 0, 1)],
    ]);
  });

  it("moves elements to the right column when the first column goes, after that column's own", () => {
    const elements = [el("a", at(1, 0, 0)), el("b", at(1, 1, 0))];
    expect(removeColumn(row, 1, 0, elements).elements.map((e) => e.position)).toEqual([at(1, 0, 1), at(1, 0, 0)]);
  });

  it("shifts later columns left, and leaves other rows and unplaced elements alone", () => {
    const elements = [el("late", at(1, 2)), el("other", at(0, 2)), el("loose")];
    expect(removeColumn(row, 1, 1, elements).elements).toEqual([el("late", at(1, 1)), el("other", at(0, 2)), el("loose")]);
  });

  it("keeps each element at its index and does not change its input", () => {
    const elements = [el("a", at(1, 1, 0)), el("b", at(1, 0, 0))];
    const out = removeColumn(row, 1, 1, elements).elements;
    expect(out.map((e) => e.name)).toEqual(["a", "b"]);
    expect(elements[0].position).toEqual(at(1, 1, 0));
  });
});
