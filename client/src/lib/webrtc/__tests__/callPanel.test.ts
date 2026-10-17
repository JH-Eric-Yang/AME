import { describe, it, expect } from "vitest";
import { arrangeTiles, callStatus, cardTitle, tileLabel } from "../callPanel";

const members = [
  { participantId: "p0", seat: 0, slotName: null },
  { participantId: "p1", seat: 1, slotName: null },
  { participantId: "p2", seat: 2, slotName: null },
];

describe("cardTitle", () => {
  it("puts the participant's role in place of {role}", () => {
    expect(cardTitle("{role} task", "Director")).toBe("Director task");
    expect(cardTitle("Round with {role} and {role}", "Matcher")).toBe("Round with Matcher and Matcher");
  });

  it("gives an empty title, which hides the row, when nothing is left", () => {
    expect(cardTitle(undefined, "Director")).toBe("");
    expect(cardTitle("  ", null)).toBe("");
    expect(cardTitle("{role}", null)).toBe("");
  });

  it("keeps a plain title as it is", () => {
    expect(cardTitle("Find the figure", null)).toBe("Find the figure");
  });
});

describe("tileLabel", () => {
  it("uses the role name when the server sent one", () => {
    expect(tileLabel("p1", { peerCount: 2, memberRoles: { p1: "Listener" }, members })).toBe("Listener");
  });

  it("says 'Your partner' for the only other person without a role", () => {
    expect(tileLabel("p1", { peerCount: 1, memberRoles: {}, members })).toBe("Your partner");
  });

  it("numbers people by seat when there are several and no roles", () => {
    expect(tileLabel("p2", { peerCount: 2, memberRoles: {}, members })).toBe("Participant 3");
    expect(tileLabel("unknown", { peerCount: 2, memberRoles: {}, members })).toBe("Participant");
  });
});

describe("arrangeTiles", () => {
  it("keeps the own video as an inset for one or two others", () => {
    expect(arrangeTiles(1)).toEqual({ columns: 1, selfInset: true });
    expect(arrangeTiles(2)).toEqual({ columns: 1, selfInset: true });
  });

  it("uses a two-column grid with the own video as a tile from three others", () => {
    expect(arrangeTiles(3)).toEqual({ columns: 2, selfInset: false });
    expect(arrangeTiles(5)).toEqual({ columns: 2, selfInset: false });
  });
});

describe("callStatus", () => {
  it("waits until the match, then connects every assigned peer", () => {
    expect(callStatus(false, ["p1"], ["p1"])).toBe("waiting");
    expect(callStatus(true, [], [])).toBe("connecting");
    expect(callStatus(true, ["p1", "p2"], ["p1"])).toBe("connecting");
    expect(callStatus(true, ["p1", "p2"], ["p2", "p1"])).toBe("connected");
  });
});
