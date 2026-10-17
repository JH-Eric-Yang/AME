import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import type { ExperimentConfigPayload } from "ame-shared";
import { runner, canProceed } from "../runner";

const config: ExperimentConfigPayload = {
  id: "exp1",
  name: "Test",
  description: "",
  avCollection: false,
  bodyDetection: false,
  videoChat: false,
  supplementaryDevice: "NONE",
  participantsPerSession: 1,
  conditions: ["Basic"],
  participantIdParam: null,
};

describe("runner store", () => {
  beforeEach(() => {
    runner.reset();
  });

  describe("setConfig", () => {
    it("moves a fresh participant into the lobby", () => {
      runner.setConfig(config);
      expect(get(runner).state).toBe("LOBBY");
    });

    it("keeps the participant in place when resuming after a reconnect", () => {
      runner.setConfig(config);
      runner.setContent({
        progress: 2,
        trial: 1,
        trialInfo: {},
        routine: {
          name: "trial",
          type: "routine-card",
          layout: { rows: [] },
          matching: null,
          device: null,
        },
        elements: [],
        deviceElements: [],
      });
      expect(get(runner).state).toBe("RUNNING");

      runner.setConfig(config, true);

      // Reconnecting mid-experiment must not send the participant back to the lobby.
      expect(get(runner).state).toBe("RUNNING");
      expect(get(runner).progress).toBe(2);
    });

    it("does not resurrect a completed participant into the lobby", () => {
      runner.setCompleted();
      runner.setConfig(config, true);
      expect(get(runner).state).toBe("COMPLETED");
    });
  });

  describe("canProceed", () => {
    it("allows proceeding when no uploads are pending", () => {
      expect(get(canProceed)).toBe(true);
    });

    it("blocks proceeding while an upload is in flight", () => {
      runner.registerUpload("recording");
      expect(get(canProceed)).toBe(false);
    });

    it("allows proceeding once every upload settles", () => {
      runner.registerUpload("a");
      runner.registerUpload("b");
      runner.updateUpload("a", { status: "complete" });
      expect(get(canProceed)).toBe(false);

      runner.updateUpload("b", { status: "failed" });
      // A failed upload must not strand the participant.
      expect(get(canProceed)).toBe(true);
    });
  });

  describe("partnerDropped", () => {
    it("starts clear", () => {
      expect(get(runner).partnerDropped).toBe(false);
    });

    it("records that a session partner has gone", () => {
      runner.setPartnerDropped();
      expect(get(runner).partnerDropped).toBe(true);
    });

    it("clears the flag when the next routine's content arrives", () => {
      runner.setPartnerDropped();
      runner.setContent({
        progress: 3,
        trial: 2,
        trialInfo: {},
        routine: {
          name: "chat",
          type: "routine-video-chat",
          layout: { rows: [] },
          matching: null,
          device: null,
        },
        elements: [],
        deviceElements: [],
      });
      expect(get(runner).partnerDropped).toBe(false);
    });
  });

  describe("deviceConnected", () => {
    it("starts clear", () => {
      expect(get(runner).deviceConnected).toBe(false);
    });

    it("is set when the controller pairs", () => {
      runner.setDeviceConnected(true);
      expect(get(runner).deviceConnected).toBe(true);
    });

    it("is cleared when the controller disconnects", () => {
      runner.setDeviceConnected(true);
      runner.setDeviceConnected(false);
      expect(get(runner).deviceConnected).toBe(false);
    });

    it("survives a routine change, unlike the per-routine deviceElements", () => {
      // The phone stays paired across routines; only the content it is
      // showing is per-routine.
      runner.setDeviceConnected(true);
      runner.setContent({
        progress: 5,
        trial: 1,
        trialInfo: {},
        routine: {
          name: "next",
          type: "routine-card",
          layout: { rows: [] },
          matching: null,
          device: { mode: "controller" },
        },
        elements: [],
        deviceElements: [],
      });
      expect(get(runner).deviceConnected).toBe(true);
    });
  });

  describe("setMatched", () => {
    /** setContent preserves a group when the payload carries none. */
    function deliverContentWithoutGroup() {
      runner.setContent({
        progress: 4,
        trial: 1,
        trialInfo: {},
        routine: {
          name: "chat",
          type: "routine-video-chat",
          layout: { rows: [] },
          matching: null,
          device: null,
        },
        elements: [],
        deviceElements: [],
      });
    }

    it("drops the previous block's interaction group when a session is cleared", () => {
      runner.setMatched("session-1", ["p2"], 0, "slot-1");
      runner.setContent({
        progress: 3,
        trial: 1,
        trialInfo: {},
        routine: {
          name: "chat",
          type: "routine-video-chat",
          layout: { rows: [] },
          matching: null,
          device: null,
        },
        elements: [],
        deviceElements: [],
        interactionGroup: { peers: ["p2"], seat: 0, groupIndex: 0 },
      });
      expect(get(runner).interactionGroup).not.toBeNull();

      // How RoutineEndMatching ends a matching block.
      runner.setMatched("", [], 0, "");
      deliverContentWithoutGroup();

      // Without this the next block's video chat dials block one's dead peers:
      // an interaction group always wins over `peers` in peerSelection.
      expect(get(runner).interactionGroup).toBeNull();
    });

    it("drops it again when a second session is formed", () => {
      runner.setMatched("session-1", ["p2"], 0, "slot-1");
      runner.setContent({
        progress: 3,
        trial: 1,
        trialInfo: {},
        routine: {
          name: "chat",
          type: "routine-video-chat",
          layout: { rows: [] },
          matching: null,
          device: null,
        },
        elements: [],
        deviceElements: [],
        interactionGroup: { peers: ["p2"], seat: 0, groupIndex: 0 },
      });

      runner.setMatched("session-2", ["p7"], 1, "slot-2");
      deliverContentWithoutGroup();

      expect(get(runner).interactionGroup).toBeNull();
      expect(get(runner).peers).toEqual(["p7"]);
    });
  });

  describe("setMatchingTimedOut", () => {
    it("starts clear", () => {
      expect(get(runner).matchingTimedOut).toBe(false);
    });

    it("leaves the matching screen without inventing a session", () => {
      runner.setMatching(1, 2);
      runner.setMatchingTimedOut();

      const state = get(runner);
      expect(state.state).toBe("RUNNING");
      expect(state.matchingStatus).toBeNull();
      expect(state.matchingTimedOut).toBe(true);
      // No session was formed, and saying otherwise is what made the timeout
      // path indistinguishable from "still waiting".
      expect(state.sessionId).toBeNull();
    });

    it("clears the flag when the next routine's content arrives", () => {
      runner.setMatchingTimedOut();
      runner.setContent({
        progress: 5,
        trial: 1,
        trialInfo: {},
        routine: {
          name: "next",
          type: "routine-card",
          layout: { rows: [] },
          matching: null,
          device: null,
        },
        elements: [],
        deviceElements: [],
      });
      expect(get(runner).matchingTimedOut).toBe(false);
    });

    it("clears the flag when a later block does form a session", () => {
      runner.setMatchingTimedOut();
      runner.setMatched("session-2", ["p7"], 1, "slot-2");
      expect(get(runner).matchingTimedOut).toBe(false);
    });
  });

  describe("cohort sync", () => {
    const contentAt = (progress: number) => ({
      progress,
      trial: 1,
      trialInfo: {},
      routine: {
        name: "trial",
        type: "routine-card" as const,
        layout: { rows: [] },
        matching: null,
        device: null,
      },
      elements: [],
      deviceElements: [],
    });

    it("keeps a barrier notice that belongs to the routine now arriving", () => {
      // The member served last in the release loop hears about the NEXT
      // barrier before their own content lands. Clearing on every content
      // left them the only one never told somebody was waiting on them.
      runner.setCohortSync(1, 2, 2);

      runner.setContent(contentAt(2));

      expect(get(runner).cohortSync).toEqual({ submitted: 1, total: 2, progress: 2 });
    });

    it("drops a notice left over from an earlier routine", () => {
      runner.setCohortSync(1, 2, 2);

      runner.setContent(contentAt(3));

      expect(get(runner).cohortSync).toBeNull();
    });
  });

  describe("unresolvedRefs", () => {
    const content = (unresolvedRefs?: string[]) => ({
      progress: 1,
      routine: { name: "recap", type: "routine-card" as const, layout: { rows: [] }, matching: null, device: null },
      elements: [],
      deviceElements: [],
      trial: 1,
      trialInfo: {},
      ...(unresolvedRefs ? { unresolvedRefs } : {}),
    });

    it("keeps what the server could not resolve for this routine", () => {
      runner.setContent(content(["ref:self/p0/clip"]));
      expect(get(runner).unresolvedRefs).toEqual(["ref:self/p0/clip"]);
    });

    it("clears it on the next routine", () => {
      runner.setContent(content(["ref:self/p0/clip"]));
      runner.setContent(content());
      expect(get(runner).unresolvedRefs).toEqual([]);
    });
  });

  describe("session members", () => {
    const members = [
      { participantId: "p1", seat: 0, slotName: "A" },
      { participantId: "p2", seat: 1, slotName: "B" },
    ];
    const content = (over: Record<string, unknown> = {}) => ({
      progress: 3,
      trial: 1,
      trialInfo: {},
      routine: { name: "chat", type: "routine-card" as const, layout: { rows: [] }, matching: null, device: null },
      elements: [],
      deviceElements: [],
      ...over,
    });

    it("starts empty and takes the cohort from match:matched", () => {
      expect(get(runner).sessionMembers).toEqual([]);
      runner.setMatched("session-1", ["p2"], 0, "A", members);
      expect(get(runner).sessionMembers).toEqual(members);
    });

    it("takes the cohort from content, and keeps it when content carries none", () => {
      runner.setContent(content({ sessionMembers: members }));
      expect(get(runner).sessionMembers).toEqual(members);
      runner.setContent(content());
      expect(get(runner).sessionMembers).toEqual(members);
    });

    it("keeps the group's members", () => {
      const group = { peers: ["p2"], seat: 0, groupIndex: 0, members };
      runner.setContent(content({ interactionGroup: group }));
      expect(get(runner).interactionGroup).toEqual(group);
    });

    it("clears the cohort when the session ends", () => {
      runner.setMatched("session-1", ["p2"], 0, "A", members);
      runner.setMatched("", [], 0, "");
      expect(get(runner).sessionMembers).toEqual([]);
    });
  });
});
