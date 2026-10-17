import type { RoutineLayout, GridRow, GridColumn, CellAlign } from "../types.js";
import type { StyleMap } from "./style.js";

/** Columns in a row. A span of 6 is half the row's width. */
const GridColumns = 12;

/** Space between rows, and between the columns within a row. */
export const DefaultGap = "1rem";

/** Space around the whole grid. Card routines pass "0": the card supplies its own. */
export const DefaultPadding = "1rem";

/** Space between two elements stacked in the same cell. */
const CellGap = "0.5rem";

/**
 * The layout's shorthand justify values are not all CSS keywords: "between" and
 * "around" need expanding, and an absent value means flex-start.
 */
function justifyValue(justify?: string): string {
  if (justify === "between") return "space-between";
  if (justify === "around") return "space-around";
  return justify ?? "flex-start";
}

export function containerStyle(layout: RoutineLayout): StyleMap {
  return {
    display: "flex",
    "flex-direction": "column",
    gap: layout.gap ?? DefaultGap,
    padding: layout.padding ?? DefaultPadding,
    "align-items": layout.alignItems ?? "stretch",
    "justify-content": justifyValue(layout.justifyContent),
  };
}

export function rowStyle(row: GridRow): StyleMap {
  return {
    display: "flex",
    gap: DefaultGap,
    "justify-content": justifyValue(row.justify),
  };
}

export function cellStyle(col: GridColumn, cellAlign?: CellAlign): StyleMap {
  const width = `calc(${col.span} / ${GridColumns} * 100%)`;
  return {
    display: "flex",
    "flex-direction": "column",
    gap: CellGap,
    "box-sizing": "border-box",
    flex: `0 0 ${width}`,
    "max-width": width,
    "align-items": cellAlign ?? "stretch",
  };
}

/**
 * The wrapper for an element that has a footprint but no cell of its own —
 * the `unplaced` bucket, which is the ordinary path for routines built
 * programmatically (session blocks, the e2e seed, CSV import).
 *
 * A cell in all but width: it is already a full-width child of the container,
 * so it needs no flex basis, only the alignment a cell would have given it.
 * Without this, a borderless routine's centring reaches only its positioned
 * elements.
 */
export function looseCellStyle(cellAlign: CellAlign): StyleMap {
  return {
    display: "flex",
    "flex-direction": "column",
    gap: CellGap,
    "align-items": cellAlign,
  };
}
