import { describe, it, expect } from "vitest";
import {
  buildProgressSequence,
  detectMatchingPeriods,
} from "ame-shared/randomization";
import type { RandomizationRange, RoutineConfig } from "ame-shared";

describe("buildProgressSequence", () => {
  it("returns identity sequence when no ranges provided", () => {
    const rows = [
      { progress: 0, trialNumber: 0 },
      { progress: 1, trialNumber: 0 },
      { progress: 2, trialNumber: 1 },
      { progress: 3, trialNumber: 2 },
    ];
    const result = buildProgressSequence(rows, [], 0);
    expect(result).toEqual([0, 1, 2, 3]);
  });

  it("shuffles trial groups within a range (seeded)", () => {
    const rows = [
      { progress: 0, trialNumber: 0 },
      { progress: 1, trialNumber: 1 },
      { progress: 2, trialNumber: 2 },
      { progress: 3, trialNumber: 3 },
      { progress: 4, trialNumber: 4 },
    ];
    const ranges: RandomizationRange[] = [
      { fromTrial: 1, toTrial: 3, method: "shuffle" },
    ];
    const result = buildProgressSequence(rows, ranges, 0);
    expect(result[0]).toBe(0);
    expect(result[4]).toBe(4);
    const middle = result.slice(1, 4);
    expect(middle.sort()).toEqual([1, 2, 3]);
  });

  it("keeps multi-progress trial groups together", () => {
    const rows = [
      { progress: 0, trialNumber: 0 },
      { progress: 1, trialNumber: 1 },
      { progress: 2, trialNumber: 1 },
      { progress: 3, trialNumber: 2 },
      { progress: 4, trialNumber: 2 },
      { progress: 5, trialNumber: 3 },
    ];
    const ranges: RandomizationRange[] = [
      { fromTrial: 1, toTrial: 2, method: "shuffle" },
    ];
    const result = buildProgressSequence(rows, ranges, 0);
    expect(result[0]).toBe(0);
    expect(result[5]).toBe(5);
    const middle = result.slice(1, 5);
    const valid =
      (middle[0] === 1 && middle[1] === 2 && middle[2] === 3 && middle[3] === 4) ||
      (middle[0] === 3 && middle[1] === 4 && middle[2] === 1 && middle[3] === 2);
    expect(valid).toBe(true);
  });

  it("applies latin-square ordering based on participantIndex", () => {
    const rows = [
      { progress: 0, trialNumber: 0 },
      { progress: 1, trialNumber: 1 },
      { progress: 2, trialNumber: 2 },
      { progress: 3, trialNumber: 3 },
    ];
    const ranges: RandomizationRange[] = [
      { fromTrial: 1, toTrial: 3, method: "latin-square" },
    ];
    const result0 = buildProgressSequence(rows, ranges, 0);
    expect(result0).toEqual([0, 1, 2, 3]);
    const result1 = buildProgressSequence(rows, ranges, 1);
    expect(result1).toEqual([0, 2, 3, 1]);
    const result2 = buildProgressSequence(rows, ranges, 2);
    expect(result2).toEqual([0, 3, 1, 2]);
    const result3 = buildProgressSequence(rows, ranges, 3);
    expect(result3).toEqual([0, 1, 2, 3]);
  });

  it("applies block randomization with given blockSize", () => {
    const rows = [
      { progress: 0, trialNumber: 0 },
      { progress: 1, trialNumber: 1 },
      { progress: 2, trialNumber: 2 },
      { progress: 3, trialNumber: 3 },
      { progress: 4, trialNumber: 4 },
      { progress: 5, trialNumber: 5 },
      { progress: 6, trialNumber: 6 },
    ];
    const ranges: RandomizationRange[] = [
      { fromTrial: 1, toTrial: 6, method: "block", blockSize: 3 },
    ];
    const result = buildProgressSequence(rows, ranges, 0);
    expect(result[0]).toBe(0);
    const block1 = result.slice(1, 4);
    expect(block1.sort()).toEqual([1, 2, 3]);
    const block2 = result.slice(4, 7);
    expect(block2.sort()).toEqual([4, 5, 6]);
  });

  it("handles multiple ranges independently", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      progress: i,
      trialNumber: i,
    }));
    const ranges: RandomizationRange[] = [
      { fromTrial: 1, toTrial: 3, method: "latin-square" },
      { fromTrial: 6, toTrial: 8, method: "latin-square" },
    ];
    const result = buildProgressSequence(rows, ranges, 1);
    expect(result[0]).toBe(0);
    expect(result[4]).toBe(4);
    expect(result[5]).toBe(5);
    expect(result[9]).toBe(9);
    expect(result.slice(1, 4)).toEqual([2, 3, 1]);
    expect(result.slice(6, 9)).toEqual([7, 8, 6]);
  });

  it("returns identity for empty range (no matching trials)", () => {
    const rows = [
      { progress: 0, trialNumber: 0 },
      { progress: 1, trialNumber: 1 },
    ];
    const ranges: RandomizationRange[] = [
      { fromTrial: 5, toTrial: 10, method: "shuffle" },
    ];
    const result = buildProgressSequence(rows, ranges, 0);
    expect(result).toEqual([0, 1]);
  });
});

describe("detectMatchingPeriods", () => {
  const makeRoutine = (name: string, type: string, matching?: object): RoutineConfig => ({
    name,
    type: type as RoutineConfig["type"],
    layout: { rows: [] },
    elements: [],
    ...(matching ? { matching } : {}),
  });

  it("returns empty when no matching routines exist", () => {
    const rows = [
      { progress: 0, routine: "consent" },
      { progress: 1, routine: "survey" },
    ];
    const templates = [
      makeRoutine("consent", "routine-consent"),
      makeRoutine("survey", "routine-survey"),
    ];
    expect(detectMatchingPeriods(rows, templates)).toEqual([]);
  });

  it("detects a single matching period", () => {
    const rows = [
      { progress: 0, routine: "consent" },
      { progress: 1, routine: "video-chat" },
      { progress: 2, routine: "task" },
      { progress: 3, routine: "end-match" },
      { progress: 4, routine: "survey" },
    ];
    const templates = [
      makeRoutine("consent", "routine-consent"),
      makeRoutine("video-chat", "routine-video-chat", { strategy: "fifo", slots: [] }),
      makeRoutine("task", "routine-card"),
      makeRoutine("end-match", "routine-end-matching"),
      makeRoutine("survey", "routine-survey"),
    ];
    expect(detectMatchingPeriods(rows, templates)).toEqual([
      { fromProgress: 1, toProgress: 3 },
    ]);
  });

  it("detects multiple matching periods", () => {
    const rows = [
      { progress: 0, routine: "match1" },
      { progress: 1, routine: "task1" },
      { progress: 2, routine: "end-match1" },
      { progress: 3, routine: "break" },
      { progress: 4, routine: "match2" },
      { progress: 5, routine: "task2" },
      { progress: 6, routine: "end-match2" },
    ];
    const templates = [
      makeRoutine("match1", "routine-video-chat", { strategy: "fifo", slots: [] }),
      makeRoutine("task1", "routine-card"),
      makeRoutine("end-match1", "routine-end-matching"),
      makeRoutine("break", "routine-card"),
      makeRoutine("match2", "routine-video-chat", { strategy: "fifo", slots: [] }),
      makeRoutine("task2", "routine-card"),
      makeRoutine("end-match2", "routine-end-matching"),
    ];
    expect(detectMatchingPeriods(rows, templates)).toEqual([
      { fromProgress: 0, toProgress: 2 },
      { fromProgress: 4, toProgress: 6 },
    ]);
  });

  it("closes unclosed matching period at last progress", () => {
    const rows = [
      { progress: 0, routine: "consent" },
      { progress: 1, routine: "video-chat" },
      { progress: 2, routine: "task" },
    ];
    const templates = [
      makeRoutine("consent", "routine-consent"),
      makeRoutine("video-chat", "routine-video-chat", { strategy: "fifo", slots: [] }),
      makeRoutine("task", "routine-card"),
    ];
    expect(detectMatchingPeriods(rows, templates)).toEqual([
      { fromProgress: 1, toProgress: 2 },
    ]);
  });

  it("treats routine-end as matching period terminator", () => {
    const rows = [
      { progress: 0, routine: "video-chat" },
      { progress: 1, routine: "task" },
      { progress: 2, routine: "end" },
      { progress: 3, routine: "survey" },
    ];
    const templates = [
      makeRoutine("video-chat", "routine-video-chat", { strategy: "fifo", slots: [] }),
      makeRoutine("task", "routine-card"),
      makeRoutine("end", "routine-end"),
      makeRoutine("survey", "routine-survey"),
    ];
    expect(detectMatchingPeriods(rows, templates)).toEqual([
      { fromProgress: 0, toProgress: 2 },
    ]);
  });
});
