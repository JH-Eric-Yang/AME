/**
 * The shape `coverageMatrix()` returns (shared/src/sessionDesign.ts). Declared
 * structurally rather than imported so this module — and its test — stay free
 * of any `ame-shared` value import.
 */
export interface PairCoverage {
  /** Seat pair → the 1-based trials at which it meets. */
  pairs: Map<string, number[]>;
  total: number;
  met: number;
  repeats: number;
}

/** The key `coverageMatrix()` files a pair under: 0-based seats, lower first. */
export function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/**
 * `unused` is the diagonal and the lower triangle — a pair is shown once, above
 * the diagonal. `repeat` is a pair that meets more than once, which a full
 * round-robin never produces.
 */
export type CoverageState = "unused" | "never" | "once" | "repeat";

export interface CoverageCell {
  row: number;
  column: number;
  text: string;
  state: CoverageState;
  title: string;
}

export interface CoverageRow {
  seat: number;
  label: string;
  cells: CoverageCell[];
}

export interface CoverageGrid {
  /** 1-based column headings. */
  heads: number[];
  rows: CoverageRow[];
  total: number;
  met: number;
  repeats: number;
  never: number;
}

function buildCell(coverage: PairCoverage, row: number, column: number): CoverageCell {
  if (column <= row) {
    return { row, column, text: "", state: "unused", title: "" };
  }

  const pair = `Seats ${row + 1} and ${column + 1}`;
  const trials = coverage.pairs.get(pairKey(row, column)) ?? [];

  if (trials.length === 0) {
    return { row, column, text: "", state: "never", title: `${pair} never meet` };
  }

  const text = trials.map((trial) => `T${trial}`).join("/");
  if (trials.length === 1) {
    return { row, column, text, state: "once", title: `${pair} meet on trial ${trials[0]}` };
  }
  return { row, column, text, state: "repeat", title: `${pair} meet ${trials.length} times` };
}

/**
 * Turn a `coverageMatrix()` result into the upper-triangle grid the Coverage
 * tab renders. Pure, so the schedule is auditable by test rather than by eye.
 */
export function buildCoverageGrid(coverage: PairCoverage, cohortSize: number): CoverageGrid {
  const heads = Array.from({ length: cohortSize }, (_, i) => i + 1);
  const rows = Array.from({ length: cohortSize }, (_, row) => ({
    seat: row,
    label: `Seat ${row + 1}`,
    cells: Array.from({ length: cohortSize }, (_, column) => buildCell(coverage, row, column)),
  }));

  return {
    heads,
    rows,
    total: coverage.total,
    met: coverage.met,
    repeats: coverage.repeats,
    never: coverage.total - coverage.met,
  };
}
