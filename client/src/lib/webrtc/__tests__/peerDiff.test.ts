import { describe, it, expect } from "vitest";
import { diffPeers } from "../peerDiff";

describe("diffPeers", () => {
  it("opens every desired peer when nothing is connected", () => {
    expect(diffPeers([], ["p3", "p1"])).toEqual({
      toOpen: ["p1", "p3"],
      toClose: [],
      unchanged: [],
    });
  });

  it("keeps a shared peer across a rotation instead of reopening it", () => {
    expect(diffPeers(["p2", "p3"], ["p3", "p4"])).toEqual({
      toOpen: ["p4"],
      toClose: ["p2"],
      unchanged: ["p3"],
    });
  });

  it("closes everything when the desired group is empty", () => {
    expect(diffPeers(["p2", "p1"], [])).toEqual({
      toOpen: [],
      toClose: ["p1", "p2"],
      unchanged: [],
    });
  });

  it("plans nothing when the group is unchanged", () => {
    expect(diffPeers(["p1", "p2"], ["p2", "p1"])).toEqual({
      toOpen: [],
      toClose: [],
      unchanged: ["p1", "p2"],
    });
  });

  it("collapses duplicates and sorts deterministically", () => {
    expect(diffPeers(["p2", "p2"], ["p1", "p1", "p2"])).toEqual({
      toOpen: ["p1"],
      toClose: [],
      unchanged: ["p2"],
    });
  });
});
