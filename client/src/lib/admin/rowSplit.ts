import type { ElementConfig, GridColumn, GridRow } from "ame-shared";

/**
 * Whether a row has room for one more column, honouring the only rule
 * CanvasToolbar's parseColumnSpans enforces: every column's span is at
 * least 1, and the row's spans sum to at most 12. Splitting redistributes
 * the row's *existing* total rather than growing it (see splitRowColumns),
 * so the limit is reached once that total can no longer give every column
 * — including a new one — a span of at least 1. That is the "maximum
 * sensible number of columns" for the row: e.g. four columns already
 * summing to 4 (each span 1) cannot become five.
 */
export function canSplitRow(row: GridRow): boolean {
  const total = row.columns.reduce((sum, c) => sum + c.span, 0);
  return total >= row.columns.length + 1;
}

/**
 * The row's columns after adding one more, evenly dividing the row's
 * existing total span — not a fresh 12 — so a row deliberately narrower
 * than the full grid stays that width after splitting. Any remainder from
 * an uneven division goes to the earliest columns. The result always
 * satisfies parseColumnSpans: unchanged sum, every span at least 1.
 */
export function splitRowColumns(row: GridRow): GridColumn[] {
  const total = row.columns.reduce((sum, c) => sum + c.span, 0);
  const count = row.columns.length + 1;
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, i) => ({ span: base + (i < remainder ? 1 : 0) }));
}

/** A row must keep one column; removing the last one would leave no cell. */
export function canRemoveColumn(row: GridRow): boolean {
  return row.columns.length > 1;
}

export interface ColumnRemoval {
  columns: GridColumn[];
  /** The routine's elements, same length and order — the builder indexes them. */
  elements: ElementConfig[];
}

/**
 * The row without `column`, and the routine's elements re-pointed to match.
 * The removed span goes to the column on the left (on the right for the first
 * column), and that column also receives the removed column's elements, after
 * its own and in their own order — so no element loses its place and the row
 * keeps its width. Later columns in the row shift one index to the left.
 */
export function removeColumn(row: GridRow, rowIndex: number, column: number, elements: ElementConfig[]): ColumnRemoval {
  const target = column > 0 ? column - 1 : 1;
  const columns = row.columns
    .map((c, i) => (i === target ? { ...c, span: c.span + row.columns[column].span } : c))
    .filter((_, i) => i !== column);

  const inRow = (el: ElementConfig, col: number) => el.position?.row === rowIndex && el.position.column === col;
  const orderOf = (el: ElementConfig) => el.position?.order ?? 0;
  const lastOrder = Math.max(-1, ...elements.filter((el) => inRow(el, target)).map(orderOf));
  const moved = elements.filter((el) => inRow(el, column)).sort((a, b) => orderOf(a) - orderOf(b));
  // Indices above `column` lose one; the target keeps its index only when it is on the left.
  const shift = (col: number) => (col > column ? col - 1 : col);

  return {
    columns,
    elements: elements.map((el) => {
      if (!el.position || el.position.row !== rowIndex) return el;
      if (el.position.column === column) {
        return { ...el, position: { ...el.position, column: shift(target), order: lastOrder + 1 + moved.indexOf(el) } };
      }
      return el.position.column > column ? { ...el, position: { ...el.position, column: shift(el.position.column) } } : el;
    }),
  };
}
