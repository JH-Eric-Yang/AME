import { describe, it, expect } from "vitest";
import { resolveRoutineSelection } from "../routineSelection";

describe("resolveRoutineSelection", () => {
  it("selects the first routine when nothing is selected", () => {
    // The Builder tab opened with selectedRoutineIndex null, so the canvas
    // showed "Select a routine to view its canvas." and no grid at all.
    expect(resolveRoutineSelection(5, null)).toBe(0);
  });

  it("leaves an existing selection alone", () => {
    expect(resolveRoutineSelection(5, 3)).toBe(3);
    expect(resolveRoutineSelection(5, 0)).toBe(0);
  });

  it("selects nothing when the experiment has no routines", () => {
    expect(resolveRoutineSelection(0, null)).toBe(null);
    expect(resolveRoutineSelection(0, 2)).toBe(null);
  });

  it("clamps a selection that outlived the routine it pointed at", () => {
    // removeRoutine() drops a routine from the array; a selection past the
    // new end would render an empty canvas with no way back to one.
    expect(resolveRoutineSelection(3, 7)).toBe(2);
    expect(resolveRoutineSelection(1, 1)).toBe(0);
  });

  it("recovers from a negative index rather than propagating it", () => {
    expect(resolveRoutineSelection(3, -1)).toBe(0);
  });

  it("is idempotent: re-resolving its own answer changes nothing", () => {
    // The Svelte $effect calls selectRoutine only when the answer differs
    // from the current selection, so a non-idempotent result would loop.
    for (const [count, selected] of [
      [5, null],
      [3, 7],
      [1, 1],
      [3, -1],
      [0, 2],
    ] as const) {
      const once = resolveRoutineSelection(count, selected);
      expect(resolveRoutineSelection(count, once)).toBe(once);
    }
  });
});
