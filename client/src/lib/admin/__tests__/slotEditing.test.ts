import { describe, it, expect } from "vitest";
import {
  resizeSlots,
  MinSlotCount,
  MaxSlotCount,
} from "$lib/admin/slotEditing";

describe("resizeSlots", () => {
  it("grows an empty list to the requested count with numbered names", () => {
    expect(resizeSlots([], 3)).toEqual([
      { name: "Slot 1" },
      { name: "Slot 2" },
      { name: "Slot 3" },
    ]);
  });

  it("preserves existing names and filters when growing", () => {
    const existing = [
      { name: "speaker", filters: [{ property: "role", operator: "eq" as const, value: "a" }] },
      { name: "listener" },
    ];

    expect(resizeSlots(existing, 4)).toEqual([
      { name: "speaker", filters: [{ property: "role", operator: "eq" as const, value: "a" }] },
      { name: "listener" },
      { name: "Slot 3" },
      { name: "Slot 4" },
    ]);
  });

  it("truncates from the end when shrinking, keeping the earlier slots intact", () => {
    const existing = [
      { name: "speaker", filters: [{ property: "role", operator: "eq" as const, value: "a" }] },
      { name: "listener" },
      { name: "observer" },
    ];

    expect(resizeSlots(existing, 2)).toEqual([
      { name: "speaker", filters: [{ property: "role", operator: "eq" as const, value: "a" }] },
      { name: "listener" },
    ]);
  });

  it("returns the list unchanged when the count already matches", () => {
    const existing = [{ name: "a" }, { name: "b" }];
    expect(resizeSlots(existing, 2)).toEqual(existing);
  });

  it("clamps a count below the server minimum", () => {
    expect(resizeSlots([], 0)).toHaveLength(MinSlotCount);
    expect(resizeSlots([{ name: "a" }, { name: "b" }], 1)).toHaveLength(
      MinSlotCount,
    );
  });

  it("clamps a count above the maximum", () => {
    expect(resizeSlots([], MaxSlotCount + 5)).toHaveLength(MaxSlotCount);
  });

  it("leaves the list untouched for a non-integer count", () => {
    const existing = [{ name: "a" }, { name: "b" }, { name: "c" }];
    // An emptied number input yields parseInt("") === NaN.
    expect(resizeSlots(existing, Number.NaN)).toEqual(existing);
    expect(resizeSlots(existing, 2.5)).toEqual(existing);
  });
});
