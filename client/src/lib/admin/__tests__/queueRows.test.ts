import { describe, it, expect } from "vitest";
import { participantLabel, formatWaitTime } from "../queueRows";

const JoinedAt = 1_757_150_000_000;

describe("participantLabel", () => {
  it("prefers the recruitment id, which is what the person will quote", () => {
    expect(
      participantLabel({ participantId: "5f2a9c11-dead-beef", externalId: "PROLIFIC_6KD2" }),
    ).toBe("PROLIFIC_6KD2");
  });

  it("falls back to a short internal id when no recruitment id was captured", () => {
    expect(
      participantLabel({ participantId: "5f2a9c11-dead-beef", externalId: null }),
    ).toBe("5f2a9c11");
  });
});

describe("formatWaitTime", () => {
  it("reads m:ss with a padded seconds field", () => {
    expect(formatWaitTime(JoinedAt, JoinedAt + 42_000)).toBe("0:42");
    expect(formatWaitTime(JoinedAt, JoinedAt + 11_000)).toBe("0:11");
    expect(formatWaitTime(JoinedAt, JoinedAt + 65_000)).toBe("1:05");
  });

  it("advances purely as a function of `now`, never of when it was called", () => {
    // The frozen-wait bug: the old version read Date.now() itself, so a queue
    // that emitted no events showed the same number forever.
    expect(formatWaitTime(JoinedAt, JoinedAt + 1_000)).not.toBe(
      formatWaitTime(JoinedAt, JoinedAt + 2_000),
    );
  });

  it("never shows a negative wait when clocks disagree", () => {
    expect(formatWaitTime(JoinedAt, JoinedAt - 5_000)).toBe("0:00");
  });
});
