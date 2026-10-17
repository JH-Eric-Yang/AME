import { describe, it, expect } from "vitest";
import { pairKey, buildCoverageGrid, type PairCoverage } from "$lib/admin/coverageGrid";

/**
 * Three seats: seats 1–2 meet once, seats 1–3 meet twice, seats 2–3 never.
 * Keys and trial numbers are exactly what `coverageMatrix()` returns:
 * 0-based seats, lower first; 1-based trials.
 */
const ThreeSeatCoverage: PairCoverage = {
  pairs: new Map([
    ["0-1", [2]],
    ["0-2", [1, 3]],
  ]),
  total: 3,
  met: 2,
  repeats: 1,
};

describe("pairKey", () => {
  it("orders the two seats so either argument order finds the same pair", () => {
    expect(pairKey(2, 5)).toBe("2-5");
    expect(pairKey(5, 2)).toBe("2-5");
  });
});

describe("buildCoverageGrid", () => {
  it("labels rows and columns with 1-based seats", () => {
    const grid = buildCoverageGrid(ThreeSeatCoverage, 3);
    expect(grid.heads).toEqual([1, 2, 3]);
    expect(grid.rows.map((r) => r.label)).toEqual(["Seat 1", "Seat 2", "Seat 3"]);
  });

  it("blanks the diagonal and everything below it", () => {
    const grid = buildCoverageGrid(ThreeSeatCoverage, 3);
    expect(grid.rows[1].cells[0]).toMatchObject({ state: "unused", text: "" });
    expect(grid.rows[1].cells[1]).toMatchObject({ state: "unused", text: "" });
    expect(grid.rows[2].cells.map((c) => c.state)).toEqual(["unused", "unused", "unused"]);
  });

  it("shows the single trial at which a pair meets", () => {
    const grid = buildCoverageGrid(ThreeSeatCoverage, 3);
    expect(grid.rows[0].cells[1]).toMatchObject({
      state: "once",
      text: "T2",
      title: "Seats 1 and 2 meet on trial 2",
    });
  });

  it("shows every trial and flags a pair that meets more than once", () => {
    const grid = buildCoverageGrid(ThreeSeatCoverage, 3);
    expect(grid.rows[0].cells[2]).toMatchObject({
      state: "repeat",
      text: "T1/T3",
      title: "Seats 1 and 3 meet 2 times",
    });
  });

  it("leaves a pair that never meets blank and says so", () => {
    const grid = buildCoverageGrid(ThreeSeatCoverage, 3);
    expect(grid.rows[1].cells[2]).toMatchObject({
      state: "never",
      text: "",
      title: "Seats 2 and 3 never meet",
    });
  });

  it("derives the footer counts, including how many pairs never meet", () => {
    const grid = buildCoverageGrid(ThreeSeatCoverage, 3);
    expect(grid.total).toBe(3);
    expect(grid.met).toBe(2);
    expect(grid.repeats).toBe(1);
    expect(grid.never).toBe(1);
  });
});
