import { describe, it, expect } from "vitest";
import { mergeLines, speakerLabel } from "../threadLines";

const line = (from: string, at: number, text = "x") => ({ from, seat: 0, text, at });

describe("mergeLines", () => {
  it("orders by time and drops a line it already holds", () => {
    expect(mergeLines([line("p1", 20)], [line("p2", 10), line("p1", 20)])).toEqual([line("p2", 10), line("p1", 20)]);
  });

  it("keeps two different messages sent in the same millisecond", () => {
    expect(mergeLines([line("p1", 5, "a")], [line("p1", 5, "b")])).toEqual([line("p1", 5, "a"), line("p1", 5, "b")]);
  });

  it("does not modify its inputs", () => {
    const existing = [line("p1", 2)];
    mergeLines(existing, [line("p2", 1)]);
    expect(existing).toEqual([line("p1", 2)]);
  });
});

describe("speakerLabel", () => {
  const members = [
    { participantId: "p1", seat: 0, slotName: "Director" },
    { participantId: "p2", seat: 1, slotName: null },
  ];

  it("names the viewer, then the slot, then the seat counting from 1", () => {
    expect(speakerLabel({ from: "p1", seat: 0, text: "", at: 0 }, "p1", members)).toBe("You");
    expect(speakerLabel({ from: "p1", seat: 0, text: "", at: 0 }, "p2", members)).toBe("Director");
    expect(speakerLabel({ from: "p2", seat: 1, text: "", at: 0 }, "p1", members)).toBe("Seat 2");
    expect(speakerLabel({ from: "p9", seat: 5, text: "", at: 0 }, "p1", members)).toBe("Seat 6");
  });
});
