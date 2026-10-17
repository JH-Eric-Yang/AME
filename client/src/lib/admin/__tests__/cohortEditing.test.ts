import { describe, it, expect } from "vitest";
import type { SessionDesignIssue } from "ame-shared/sessionDesign";
import type { SessionDesign } from "ame-shared/sessionDesign";
import {
  applyAssignmentField,
  applyAssignmentMode,
  applyCohortSize,
  matchingForDesign,
  applyTimeoutSeconds,
  issuesForField,
  renameSeat,
  seatFilterLabel,
  setSeatFilters,
  timeoutWarning,
  MaxReasonableTimeoutSeconds,
} from "$lib/admin/cohortEditing";
import { MaxSlotCount } from "$lib/admin/slotEditing";

const HandednessFilter = {
  property: "handedness",
  operator: "eq" as const,
  value: "left",
};

describe("applyCohortSize", () => {
  it("grows the seat list and reports the matching cohort size", () => {
    expect(applyCohortSize([{ name: "Slot 1" }, { name: "Slot 2" }], 4)).toEqual({
      cohortSize: 4,
      seats: [
        { name: "Slot 1" },
        { name: "Slot 2" },
        { name: "Slot 3" },
        { name: "Slot 4" },
      ],
    });
  });

  it("shrinks the seat list, keeping the surviving seats' filters", () => {
    const seats = [
      { name: "a", filters: [HandednessFilter] },
      { name: "b" },
      { name: "c" },
    ];

    expect(applyCohortSize(seats, 2)).toEqual({
      cohortSize: 2,
      seats: [{ name: "a", filters: [HandednessFilter] }, { name: "b" }],
    });
  });

  it("reports the clamped size rather than the typed one", () => {
    // resizeSlots caps the list; cohortSize must never disagree with seats.length.
    expect(applyCohortSize([], MaxSlotCount + 5).cohortSize).toBe(MaxSlotCount);
  });

  it("keeps the current size when the field is emptied mid-edit", () => {
    const seats = [{ name: "a" }, { name: "b" }, { name: "c" }];
    // An emptied number input yields parseInt("") === NaN.
    expect(applyCohortSize(seats, Number.NaN)).toEqual({ cohortSize: 3, seats });
  });
});

describe("renameSeat", () => {
  it("renames only the target seat and keeps its filters", () => {
    const seats = [{ name: "a", filters: [HandednessFilter] }, { name: "b" }];

    expect(renameSeat(seats, 0, "speaker")).toEqual([
      { name: "speaker", filters: [HandednessFilter] },
      { name: "b" },
    ]);
  });

  it("returns the same list for an index outside the seat range", () => {
    const seats = [{ name: "a" }, { name: "b" }];
    expect(renameSeat(seats, 5, "x")).toBe(seats);
  });
});

describe("setSeatFilters", () => {
  it("attaches filters to one seat only", () => {
    expect(
      setSeatFilters([{ name: "a" }, { name: "b" }], 1, [HandednessFilter]),
    ).toEqual([{ name: "a" }, { name: "b", filters: [HandednessFilter] }]);
  });

  it("removes the filters key when the editor empties the list", () => {
    const seats = [{ name: "a", filters: [HandednessFilter] }];
    // A seat left with `filters: []` must read as filterless to
    // validateSessionDesign's "property strategy with a filterless seat" rule.
    expect(setSeatFilters(seats, 0, [])[0]).not.toHaveProperty("filters");
  });

  it("returns the same list for an index outside the seat range", () => {
    const seats = [{ name: "a" }];
    expect(setSeatFilters(seats, 2, [HandednessFilter])).toBe(seats);
  });
});

describe("seatFilterLabel", () => {
  it("invites filters on a seat that has none", () => {
    expect(seatFilterLabel({ name: "a" }, false)).toBe("+ filters");
    expect(seatFilterLabel({ name: "a", filters: [] }, false)).toBe("+ filters");
  });

  it("counts the filters a collapsed seat carries", () => {
    expect(
      seatFilterLabel({ name: "a", filters: [HandednessFilter, HandednessFilter] }, false),
    ).toBe("filters (2)");
  });

  it("offers to collapse an open seat", () => {
    expect(seatFilterLabel({ name: "a", filters: [HandednessFilter] }, true)).toBe(
      "- filters",
    );
  });
});

describe("applyTimeoutSeconds", () => {
  it("patches the parsed number of seconds", () => {
    expect(applyTimeoutSeconds("45")).toEqual({ timeoutSeconds: 45 });
  });

  it("patches nothing for an emptied or negative field", () => {
    expect(applyTimeoutSeconds("")).toEqual({});
    expect(applyTimeoutSeconds("-30")).toEqual({});
  });
});

describe("timeoutWarning", () => {
  it("stays silent at or below an hour", () => {
    expect(timeoutWarning(300)).toBeNull();
    expect(timeoutWarning(MaxReasonableTimeoutSeconds)).toBeNull();
  });

  it("names the wait in hours above an hour", () => {
    expect(timeoutWarning(7200)).toBe(
      "Over an hour — a stranded participant waits about 2h before the timeout fires.",
    );
  });
});

describe("issuesForField", () => {
  const issues: SessionDesignIssue[] = [
    {
      level: "error",
      message: "A cohort of 7 cannot be split into groups of 2.",
      field: "cohortSize",
    },
    { level: "warning", message: "Seat 3 has no property filters.", field: "seats.2" },
    { level: "error", message: "Trial routine still carries its own matching." },
  ];

  it("returns only the issues attributed to the requested field", () => {
    expect(issuesForField(issues, "cohortSize")).toEqual([issues[0]]);
  });

  it("collects a field's indexed issues under the field itself", () => {
    // validateSessionDesign emits per-seat errors as `seats.<i>`; the seats
    // fieldset asks for "seats" and must still receive them.
    expect(issuesForField(issues, "seats")).toEqual([issues[1]]);
  });

  it("never returns an issue with no field, which belongs to the apply bar", () => {
    expect(issuesForField(issues, "trialRoutine")).toEqual([]);
  });
});

describe("matchingForDesign", () => {
  const design = {
    strategy: "fifo",
    seats: [{ name: "director" }, { name: "matcher" }],
  } as SessionDesign;

  it("reads the block's strategy and seats as the config it compiles to", () => {
    expect(matchingForDesign(design)).toEqual({
      strategy: "fifo",
      slots: [{ name: "director" }, { name: "matcher" }],
    });
  });

  it("omits the assignment key for a design that carries none", () => {
    // Absent, not `{ mode: "random" }` — the run-time default already governs,
    // and describeAssignment must not report a choice nobody made.
    expect("assignment" in matchingForDesign(design)).toBe(false);
  });

  it("carries a counterbalanced assignment through", () => {
    const assignment = { mode: "counterbalanced", set: "rotation", order: "sequential" } as const;
    expect(matchingForDesign({ ...design, assignment })).toMatchObject({ assignment });
  });
});

describe("applyAssignmentMode", () => {
  it("seeds counterbalancing with the scheme that balances soonest", () => {
    expect(applyAssignmentMode("counterbalanced")).toEqual({
      assignment: { mode: "counterbalanced", set: "rotation", order: "sequential" },
    });
  });

  it("clears the assignment for random", () => {
    expect(applyAssignmentMode("random")).toEqual({ assignment: undefined });
  });
});

describe("applyAssignmentField", () => {
  const cb = { mode: "counterbalanced", set: "rotation", order: "sequential" } as const;

  it("changes one field and leaves the other", () => {
    expect(applyAssignmentField(cb, { order: "block-shuffled" })).toEqual({
      assignment: { mode: "counterbalanced", set: "rotation", order: "block-shuffled" },
    });
  });

  it("patches nothing when the design is not counterbalanced", () => {
    expect(applyAssignmentField({ mode: "random" }, { set: "permutation" })).toEqual({});
    expect(applyAssignmentField(undefined, { set: "permutation" })).toEqual({});
  });
});
