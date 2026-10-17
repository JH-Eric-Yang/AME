import { describe, it, expect } from "vitest";
import type { SessionSummary } from "ame-shared";
import { seatLabel, pairingChips, seatRows, sessionHeading } from "../sessionRows";

const TrialFourProgress = 5;
const TrialFourNumber = 4;

const seat = (
  index: number,
  externalId: string | null,
  status: "ACTIVE" | "DROPPED",
  progress: number,
) => ({
  seat: index,
  slotName: `seat-${index}`,
  participantId: `${index}0000000-aaaa-bbbb-cccc-dddddddddddd`,
  externalId,
  status,
  progress,
});

const group = (groupIndex: number, seats: number[]) => ({
  progress: TrialFourProgress,
  trialNumber: TrialFourNumber,
  groupIndex,
  seats,
  participantIds: seats.map((s) => `${s}0000000-aaaa-bbbb-cccc-dddddddddddd`),
});

const cohort = (): SessionSummary => ({
  sessionId: "a41c88f0-1111-2222-3333-444455556666",
  experimentId: "exp-1",
  routineName: "Chat-match",
  // Null on every session that exists today; the block writer arrives with
  // multi-block support.
  blockId: null,
  status: "ACTIVE",
  matchProgress: 1,
  matchedAt: "2026-09-06T10:00:00.000Z",
  seatCount: 8,
  activeSeatCount: 7,
  currentProgress: TrialFourProgress,
  currentTrialNumber: TrialFourNumber,
  groupings: [
    group(0, [0, 3]),
    group(1, [4]), // seat index 2 dropped out of the scheduled 2-4 group
    group(2, [1, 5]),
    group(3, [6, 7]),
  ],
  seats: [
    seat(0, null, "ACTIVE", 5),
    seat(1, "PROLIFIC_6KD2", "ACTIVE", 5),
    seat(2, null, "DROPPED", 3),
    seat(3, null, "ACTIVE", 5),
    seat(4, null, "ACTIVE", 5),
    seat(5, null, "ACTIVE", 5),
    seat(6, null, "ACTIVE", 5),
    seat(7, null, "ACTIVE", 5),
  ],
});

describe("seatLabel", () => {
  it("renders a stored 0-based seat as its 1-based label", () => {
    // The conversion is delegated to formatSeatGroups, the single place in the
    // codebase allowed to bridge 0-based storage and 1-based display.
    expect(seatLabel(0)).toBe("1");
    expect(seatLabel(7)).toBe("8");
  });
});

describe("pairingChips", () => {
  it("shows trial 4 as 1 ↔ 4, 5 solo, 2 ↔ 6, 7 ↔ 8", () => {
    expect(pairingChips(cohort())).toEqual([
      { groupIndex: 0, text: "1 ↔ 4", solo: false },
      { groupIndex: 1, text: "5 — solo", solo: true },
      { groupIndex: 2, text: "2 ↔ 6", solo: false },
      { groupIndex: 3, text: "7 ↔ 8", solo: false },
    ]);
  });

  it("carries a unique key even when two groups render identical text", () => {
    // Two empty seat arrays both format as "? — solo". Keying the {#each} by
    // text would then be a duplicate key, and Svelte THROWS on that rather
    // than degrading, taking the whole panel down.
    const chips = pairingChips({
      ...cohort(),
      groupings: [
        { ...group(0, []), seats: [] },
        { ...group(1, []), seats: [] },
      ],
    });
    expect(chips.map((c) => c.text)).toEqual(["? — solo", "? — solo"]);
    expect(chips.map((c) => c.groupIndex)).toEqual([0, 1]);
  });

  it("has no chips before the first trial", () => {
    expect(
      pairingChips({ ...cohort(), groupings: [], currentProgress: null, currentTrialNumber: null }),
    ).toEqual([]);
  });
});

describe("seatRows", () => {
  it("labels every seat and names its partner", () => {
    const rows = seatRows(cohort());
    expect(rows.map((r) => [r.label, r.partner])).toEqual([
      ["Seat 1", "Seat 4"],
      ["Seat 2", "Seat 6"],
      ["Seat 3", "—"],
      ["Seat 4", "Seat 1"],
      ["Seat 5", "Partner unavailable"],
      ["Seat 6", "Seat 2"],
      ["Seat 7", "Seat 8"],
      ["Seat 8", "Seat 7"],
    ]);
  });

  it("shows each occupant by recruitment id where there is one", () => {
    const rows = seatRows(cohort());
    expect(rows[1].occupant).toBe("PROLIFIC_6KD2");
    expect(rows[0].occupant).toBe("00000000");
  });

  it("freezes a dropped seat at the progress it reached", () => {
    const rows = seatRows(cohort());
    expect(rows[2]).toMatchObject({ status: "DROPPED", progressLabel: "p3", partner: "—" });
    expect(rows[3]).toMatchObject({ status: "ACTIVE", progressLabel: "p5" });
  });

  it("shows no partner at all before the first trial", () => {
    const rows = seatRows({
      ...cohort(),
      groupings: [],
      currentProgress: null,
      currentTrialNumber: null,
    });
    expect(rows.every((r) => r.partner === "—")).toBe(true);
  });
});

describe("sessionHeading", () => {
  it("names the routine, the seat count and the live trial", () => {
    expect(sessionHeading(cohort())).toEqual({
      shortId: "a41c88f0",
      blockLabel: "Chat-match · 8 seats",
      trialLabel: "Trial 4 · progress 5",
      statusLabel: "Active",
    });
  });

  it("prefers a block label once a session carries one", () => {
    // Nothing writes Session.blockId yet; this pins the behaviour for when the
    // multi-block writer lands, so the heading does not have to change then.
    expect(sessionHeading({ ...cohort(), blockId: "Chat block" }).blockLabel).toBe(
      "Chat block · 8 seats",
    );
  });

  it("says so before the first trial", () => {
    expect(
      sessionHeading({
        ...cohort(),
        groupings: [],
        currentProgress: null,
        currentTrialNumber: null,
        status: "WAITING",
      }),
    ).toEqual({
      shortId: "a41c88f0",
      blockLabel: "Chat-match · 8 seats",
      trialLabel: "Not started",
      statusLabel: "Waiting",
    });
  });
});
