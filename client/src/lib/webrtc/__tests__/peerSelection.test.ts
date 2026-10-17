import { describe, it, expect } from "vitest";
import { desiredPeers } from "../peerSelection";

const SelfId = "p-self";

describe("desiredPeers", () => {
  it("falls back to the whole cohort when no interaction group has arrived", () => {
    expect(desiredPeers(null, ["p-a", "p-b", "p-c"], SelfId)).toEqual([
      "p-a",
      "p-b",
      "p-c",
    ]);
  });

  it("prefers the interaction group over the cohort", () => {
    expect(desiredPeers({ peers: ["p-b"] }, ["p-a", "p-b", "p-c"], SelfId)).toEqual([
      "p-b",
    ]);
  });

  it("returns no peers for a solo group instead of falling back to the cohort", () => {
    // An orphaned participant whose partner dropped gets peers: [].
    // Falling back here would reconnect them to the entire cohort.
    expect(desiredPeers({ peers: [] }, ["p-a", "p-b"], SelfId)).toEqual([]);
  });

  it("ignores partnerUnavailable when choosing peers", () => {
    // partnerUnavailable drives a notice in the markup, never the mesh; it must
    // not resurrect the cohort fallback for an orphaned seat.
    expect(
      desiredPeers({ peers: [], partnerUnavailable: true }, ["p-a"], SelfId),
    ).toEqual([]);
  });

  it("never returns the participant's own id from the interaction group", () => {
    expect(desiredPeers({ peers: [SelfId, "p-b"] }, [], SelfId)).toEqual(["p-b"]);
  });

  it("never returns the participant's own id from the cohort", () => {
    expect(desiredPeers(null, ["p-a", SelfId], SelfId)).toEqual(["p-a"]);
  });

  it("de-duplicates while preserving first-seen order", () => {
    expect(desiredPeers({ peers: ["p-c", "p-a", "p-c"] }, [], SelfId)).toEqual([
      "p-c",
      "p-a",
    ]);
  });

  it("keeps every peer when the participant id is not yet known", () => {
    expect(desiredPeers(null, ["p-a", "p-b"], "")).toEqual(["p-a", "p-b"]);
  });

  it("returns a fresh array that does not alias the cohort", () => {
    const cohort = ["p-a"];
    const result = desiredPeers(null, cohort, SelfId);
    result.push("p-z");
    expect(cohort).toEqual(["p-a"]);
  });
});
