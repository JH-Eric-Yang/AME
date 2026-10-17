import { describe, it, expect } from "vitest";
import type { MatchingConfig } from "ame-shared";
import { describeAssignment } from "../roleAssignmentCopy";

const twoSlots: MatchingConfig = { strategy: "fifo", slots: [{ name: "a" }, { name: "b" }] };

describe("describeAssignment", () => {
  it("describes the default when no assignment is set", () => {
    expect(describeAssignment(twoSlots)).toContain("at random");
  });

  it("names the balance guarantee for a rotation", () => {
    const copy = describeAssignment({
      ...twoSlots,
      assignment: { mode: "counterbalanced", set: "rotation", order: "sequential" },
    });

    expect(copy).toContain("every 2 sessions");
  });

  it("counts the full permutation cycle", () => {
    const copy = describeAssignment({
      strategy: "fifo",
      slots: [{ name: "a" }, { name: "b" }, { name: "c" }],
      assignment: { mode: "counterbalanced", set: "permutation", order: "sequential" },
    });

    expect(copy).toContain("every 6 sessions");
  });

  it("says the filters decide under property matching", () => {
    const copy = describeAssignment({ ...twoSlots, strategy: "property" });

    expect(copy).toContain("filters");
  });
});
