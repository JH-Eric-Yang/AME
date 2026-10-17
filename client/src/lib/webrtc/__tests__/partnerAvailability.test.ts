import { describe, it, expect } from "vitest";
import {
  DefaultPartnerUnavailableText,
  isReleasedFromMatching,
  resolvePartnerNotice,
} from "../partnerAvailability";

describe("resolvePartnerNotice", () => {
  const connected = {
    matched: true,
    partnerUnavailable: false,
    desiredPeers: ["p2"],
    connectedPeers: ["p2"],
    partnerDropped: false,
  };

  it("stays quiet while a partner is connected", () => {
    expect(resolvePartnerNotice(connected)).toBeNull();
  });

  it("stays quiet before the participant is matched", () => {
    expect(
      resolvePartnerNotice({
        ...connected,
        matched: false,
        desiredPeers: [],
        connectedPeers: [],
      }),
    ).toBeNull();
  });

  it("stays quiet while the first connection is still being negotiated", () => {
    expect(resolvePartnerNotice({ ...connected, connectedPeers: [] })).toBeNull();
  });

  it("shows the notice when the server flags the partner as unavailable", () => {
    expect(
      resolvePartnerNotice({ ...connected, partnerUnavailable: true, connectedPeers: [] }),
    ).toBe(DefaultPartnerUnavailableText);
  });

  it("shows the notice when the server assigns no peers for this rotation", () => {
    expect(
      resolvePartnerNotice({ ...connected, desiredPeers: [], connectedPeers: [] }),
    ).toBe(DefaultPartnerUnavailableText);
  });

  it("shows the notice as soon as the partner drops mid-trial", () => {
    expect(
      resolvePartnerNotice({ ...connected, connectedPeers: [], partnerDropped: true }),
    ).toBe(DefaultPartnerUnavailableText);
  });

  it("clears the notice once a rotated-in partner connects", () => {
    expect(resolvePartnerNotice({ ...connected, partnerDropped: true })).toBeNull();
  });

  it("prefers the experimenter's wording", () => {
    expect(
      resolvePartnerNotice({
        ...connected,
        desiredPeers: [],
        connectedPeers: [],
        customText: "Please wait — your partner left the study.",
      }),
    ).toBe("Please wait — your partner left the study.");
  });

  it("falls back to the default when the custom text is blank", () => {
    expect(
      resolvePartnerNotice({
        ...connected,
        desiredPeers: [],
        connectedPeers: [],
        customText: "   ",
      }),
    ).toBe(DefaultPartnerUnavailableText);
  });
});

describe("isReleasedFromMatching", () => {
  it("keeps a participant who is still queuing on the waiting overlay", () => {
    expect(
      isReleasedFromMatching({ sessionId: null, matchingTimedOut: false, memberCount: 0 }),
    ).toBe(false);
  });

  it("releases a participant who was matched into a session", () => {
    expect(
      isReleasedFromMatching({ sessionId: "sess-1", matchingTimedOut: false, memberCount: 0 }),
    ).toBe(true);
  });

  it("releases a participant whose waiting room timed out", () => {
    // No session was formed, so an empty sessionId is honest — but the
    // participant must leave the overlay and be told nobody came.
    expect(
      isReleasedFromMatching({ sessionId: null, matchingTimedOut: true, memberCount: 0 }),
    ).toBe(true);
    expect(
      resolvePartnerNotice({
        matched: isReleasedFromMatching({
          sessionId: null,
          matchingTimedOut: true,
          memberCount: 0,
        }),
        partnerUnavailable: false,
        desiredPeers: [],
        connectedPeers: [],
        partnerDropped: false,
      }),
    ).toBe(DefaultPartnerUnavailableText);
  });

  it("releases a reloaded participant: no sessionId, but the session's members arrived with content", () => {
    expect(
      isReleasedFromMatching({ sessionId: null, matchingTimedOut: false, memberCount: 2 }),
    ).toBe(true);
  });

  it("treats a session cleared with an empty id as no session", () => {
    expect(
      isReleasedFromMatching({ sessionId: "", matchingTimedOut: false, memberCount: 0 }),
    ).toBe(false);
  });
});
