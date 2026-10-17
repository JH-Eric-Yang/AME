import { describe, it, expect } from "vitest";
import type { MatchingConfig } from "ame-shared";
import { shouldEmitMatchJoin } from "../shouldJoinMatching";

const DyadMatching: MatchingConfig = {
  strategy: "fifo",
  slots: [{ name: "seat-1" }, { name: "seat-2" }],
  timeout: 300,
  timeoutAction: "wait",
};

describe("shouldEmitMatchJoin", () => {
  it("joins when the routine carries matching and no session exists yet", () => {
    expect(shouldEmitMatchJoin({ matching: DyadMatching }, null, false)).toBe(true);
  });

  it("does not join a routine that carries no matching config", () => {
    // Compiled trial routines carry matching: null. Emitting match:join for one
    // closes the cohort's session and earns a NO_MATCHING error back (B3).
    expect(shouldEmitMatchJoin({ matching: null }, null, false)).toBe(false);
  });

  it("does not join before any routine has been delivered", () => {
    expect(shouldEmitMatchJoin(null, null, false)).toBe(false);
  });

  it("does not join twice for the same mount", () => {
    expect(shouldEmitMatchJoin({ matching: DyadMatching }, null, true)).toBe(false);
  });

  it("does not re-join while a session is already established", () => {
    // match:join begins with closeActiveSessions, which resets matchProgress and
    // pins the rotation index to 0 for the rest of the run (B3).
    expect(shouldEmitMatchJoin({ matching: DyadMatching }, "session-1", false)).toBe(false);
  });

  it("treats an empty session id as no session", () => {
    // RoutineEndMatching clears the session with runner.setMatched("", [], 0, ""),
    // so sessionId is "" rather than null once a matching block has ended.
    expect(shouldEmitMatchJoin({ matching: DyadMatching }, "", false)).toBe(true);
  });

  it("leaves cohort-size validation to the server", () => {
    // The slots.length guard lives in matchingHandler (B2); duplicating it here
    // would let the two rules drift apart.
    const empty: MatchingConfig = { strategy: "fifo", slots: [] };
    expect(shouldEmitMatchJoin({ matching: empty }, null, false)).toBe(true);
  });
});
