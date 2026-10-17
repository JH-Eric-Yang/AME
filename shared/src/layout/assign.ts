import type { ElementConfig, ElementPosition, RoutineLayout } from "../types.js";
import { hasVisualFootprint } from "../visibility.js";

/**
 * An element together with its index into the routine's FULL, unfiltered
 * element array.
 *
 * The pair is the unit. The builder hands the index to selectElement and
 * moveElement, which index that full array, so an element and its index must
 * never be sorted apart — see commit 2bcd170, where they were.
 */
export interface Placed {
  element: ElementConfig;
  index: number;
}

export interface Assignment {
  /** Keyed by cellKey(row, column), each list in display order. */
  cells: Map<string, Placed[]>;
  /** No layout footprint: mounted, but occupying no space. */
  background: Placed[];
  /**
   * Has a footprint but no cell to render into — either no position at all, or
   * a position outside the layout's rows. Rendered after the grid, never
   * dropped.
   */
  unplaced: Placed[];
  /**
   * Free-mode elements with a `placement`, positioned absolutely on the stage.
   * Empty whenever `layout.mode !== "free"`.
   */
  free: Placed[];
}

export function cellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

/**
 * Whether a coordinate names a cell the layout actually has.
 *
 * A researcher can retype a row's column spans in CanvasToolbar, and
 * experiment.updateRow replaces `columns` wholesale with no position fixup, so
 * narrowing a 6:6 row to a single 12 leaves every element in column 1 pointing
 * at a cell no loop reads. Without this check those elements land in `cells`
 * under a key nothing renders and vanish from the canvas AND the participant's
 * screen with nothing in the "Not placed" strip.
 *
 * Exported because it is the definition of "placed" that everything deriving
 * geometry from a `position` has to share — `seedPlacements` seeds exactly the
 * elements this returns true for, so a flow layout that shows an element in
 * the "Not placed" strip cannot become a free layout that puts it off-stage.
 */
export function positionInRange(
  position: ElementPosition,
  layout: RoutineLayout,
): boolean {
  const row = layout.rows[position.row];
  if (!row) return false;
  return position.column >= 0 && position.column < row.columns.length;
}

export function assign(
  elements: ElementConfig[],
  layout: RoutineLayout,
  opts: { include?: (el: ElementConfig) => boolean } = {},
): Assignment {
  const include = opts.include ?? (() => true);
  const cells = new Map<string, Placed[]>();
  const background: Placed[] = [];
  const unplaced: Placed[] = [];
  const free: Placed[] = [];

  elements.forEach((element, index) => {
    if (!include(element)) return;
    const placed: Placed = { element, index };

    if (!hasVisualFootprint(element)) {
      background.push(placed);
      return;
    }

    if (layout.mode === "free") {
      // A placement is the free-mode analogue of a flow position: present, it
      // places the element; absent, the element is unplaced rather than
      // dropped — the same invariant `position` gets below.
      if (element.placement) free.push(placed);
      else unplaced.push(placed);
      return;
    }

    const position = element.position;
    if (!position || !positionInRange(position, layout)) {
      unplaced.push(placed);
      return;
    }

    const key = cellKey(position.row, position.column);
    const bucket = cells.get(key);
    if (bucket) bucket.push(placed);
    else cells.set(key, [placed]);
  });

  // Sort the pairs, never the elements alone.
  cells.forEach((bucket) =>
    bucket.sort(
      (a, b) => (a.element.position?.order ?? 0) - (b.element.position?.order ?? 0),
    ),
  );

  return { cells, background, unplaced, free };
}

export function elementsInCell(
  assignment: Assignment,
  row: number,
  column: number,
): Placed[] {
  return assignment.cells.get(cellKey(row, column)) ?? [];
}
