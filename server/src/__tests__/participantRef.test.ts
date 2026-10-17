import { describe, it, expect } from "vitest";
import { resolveParticipant, type AddressingContext } from "ame-shared/participantRef";

const members = [
  { participantId: "a", seat: 0, slotName: "A" },
  { participantId: "b", seat: 1, slotName: "B" },
  { participantId: "c", seat: 2, slotName: "C" },
  { participantId: "d", seat: 3, slotName: "D" },
];

// Seats are listed out of order on purpose: partner:k must sort by seat, not
// trust the array order the server happened to produce.
const ctx: AddressingContext = {
  selfId: "c",
  session: { members: [members[3], members[0], members[2], members[1]] },
  group: { members: [members[2], members[0], members[3]] }, // c, a, d
};

describe("resolveParticipant", () => {
  it("self is always the viewer, even with no session", () => {
    expect(resolveParticipant({ kind: "self" }, { selfId: "z", session: null, group: null })).toEqual({
      ok: true,
      participantId: "z",
    });
  });

  it("partner:k counts the OTHER group members by ascending seat", () => {
    expect(resolveParticipant({ kind: "partner", k: 1 }, ctx)).toEqual({ ok: true, participantId: "a" });
    expect(resolveParticipant({ kind: "partner", k: 2 }, ctx)).toEqual({ ok: true, participantId: "d" });
  });

  it("partner:k beyond the group is out of range", () => {
    expect(resolveParticipant({ kind: "partner", k: 3 }, ctx)).toEqual({
      ok: false,
      reason: "partner-index-out-of-range",
    });
  });

  it("seat:n is 1-based against the whole session, not just the group", () => {
    expect(resolveParticipant({ kind: "seat", n: 2 }, ctx)).toEqual({ ok: true, participantId: "b" });
    expect(resolveParticipant({ kind: "seat", n: 3 }, ctx)).toEqual({ ok: true, participantId: "c" });
  });

  it("an unoccupied seat is seat-empty", () => {
    expect(resolveParticipant({ kind: "seat", n: 5 }, ctx)).toEqual({ ok: false, reason: "seat-empty" });
  });

  it("partner and seat need a session", () => {
    const solo: AddressingContext = { selfId: "a", session: null, group: null };
    expect(resolveParticipant({ kind: "partner", k: 1 }, solo)).toEqual({ ok: false, reason: "no-session" });
    expect(resolveParticipant({ kind: "seat", n: 1 }, solo)).toEqual({ ok: false, reason: "no-session" });
  });

  it("partner with a session but no group yet is no-session", () => {
    expect(
      resolveParticipant({ kind: "partner", k: 1 }, { ...ctx, group: null }),
    ).toEqual({ ok: false, reason: "no-session" });
  });
});
