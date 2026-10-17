import { describe, it, expect } from "vitest";
import type { RoutineConfig } from "ame-shared";
import {
  achievedBalanceLine,
  achievedRoleCounts,
  experimentAssignsRoles,
} from "$lib/admin/roleBalance";

const routine = (overrides: Partial<RoutineConfig> & { name: string }): RoutineConfig => ({
  type: "routine-card",
  layout: { rows: [] },
  elements: [],
  ...overrides,
});

describe("achievedRoleCounts", () => {
  it("counts only participants who completed", () => {
    // The line exists so a researcher can see dropout skew. Counting everyone
    // would make it report the people who never reached matching instead.
    const counts = achievedRoleCounts([
      { role: 0, completion: new Date() },
      { role: 1, completion: new Date() },
      { role: 0, completion: null },
      { role: 0 },
    ]);

    expect(counts).toEqual({ 0: 1, 1: 1 });
  });

  it("excludes a withdrawal, whose role was dealt but whose data is not in the design", () => {
    const counts = achievedRoleCounts([
      { role: 1, completion: new Date() },
      { role: 1, completion: new Date(), withdraw: new Date() },
    ]);

    expect(counts).toEqual({ 1: 1 });
  });

  it("reads a missing role as the schema default", () => {
    expect(achievedRoleCounts([{ completion: new Date() }])).toEqual({ 0: 1 });
  });
});

describe("achievedBalanceLine", () => {
  it("names each role and its completed count, in role order", () => {
    const line = achievedBalanceLine([
      { role: 1, completion: 1 },
      { role: 0, completion: 1 },
      { role: 1, completion: 1 },
    ]);

    expect(line).toBe("role 0: 1 · role 1: 2");
  });

  it("returns null when nobody has completed yet", () => {
    // Null rather than an empty string, so the tab renders no element at all.
    expect(achievedBalanceLine([{ role: 0 }, { role: 1 }])).toBeNull();
    expect(achievedBalanceLine([])).toBeNull();
  });
});

describe("experimentAssignsRoles", () => {
  it("is true when some routine forms a cohort", () => {
    expect(
      experimentAssignsRoles([
        routine({ name: "intro" }),
        routine({
          name: "task-match",
          type: "routine-matching",
          matching: { strategy: "fifo", slots: [{ name: "a" }, { name: "b" }] },
        }),
      ]),
    ).toBe(true);
  });

  it("is false for a study with no matching at all", () => {
    expect(experimentAssignsRoles([routine({ name: "intro" })])).toBe(false);
  });

  it("ignores a routine whose matching was explicitly cleared", () => {
    // compileSessionDesign writes `matching: null` on its trial routine.
    expect(experimentAssignsRoles([routine({ name: "chat", matching: null })])).toBe(false);
  });
});
