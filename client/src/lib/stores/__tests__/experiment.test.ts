import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import type { RoutineConfig } from "ame-shared";
import type { SessionDesign } from "ame-shared/sessionDesign";
import { experiment } from "../experiment";

const ChatBlock: SessionDesign = {
  version: 1,
  id: "design-1",
  label: "Chat block",
  cohortSize: 8,
  strategy: "fifo",
  timeoutSeconds: 300,
  timeoutAction: "wait",
  seats: [{ name: "Seat 1" }, { name: "Seat 2" }],
  pattern: { type: "round-robin", groupSize: 2 },
  trials: 7,
  trialRoutine: "Chat",
  interTrialRoutine: null,
  conditions: ["Basic"],
  startProgress: 1,
  matchRoutineName: "Chat-match",
  endMatchRoutineName: "Chat-end-match",
  partnerUnavailableText: "Your partner is no longer available.",
  trialContent: {},
};

function routine(name: string, extra: Partial<RoutineConfig> = {}): RoutineConfig {
  return { name, type: "routine-borderless", layout: { rows: [] }, elements: [], ...extra };
}

describe("experiment store", () => {
  beforeEach(() => {
    experiment.reset();
  });

  describe("sessionDesigns state", () => {
    it("starts as an empty array on a fresh experiment", () => {
      expect(get(experiment).sessionDesigns).toEqual([]);
    });

    it("adopts designs from a loaded experiment without marking it dirty", () => {
      experiment.load({ name: "Study", routines: [], sessionDesigns: [ChatBlock] });

      expect(get(experiment).sessionDesigns).toEqual([ChatBlock]);
      expect(get(experiment).dirty).toBe(false);
    });

    it("clears designs when loading an experiment payload that has none", () => {
      experiment.load({ name: "Study", routines: [], sessionDesigns: [ChatBlock] });
      experiment.load({ name: "Other study", routines: [] });

      expect(get(experiment).sessionDesigns).toEqual([]);
    });
  });

  describe("setSessionDesigns", () => {
    it("replaces the list and marks the experiment dirty", () => {
      experiment.setSessionDesigns([ChatBlock]);

      expect(get(experiment).sessionDesigns).toEqual([ChatBlock]);
      expect(get(experiment).dirty).toBe(true);
    });
  });

  describe("upsertRoutinesByName", () => {
    it("replaces a routine in place instead of appending a duplicate", () => {
      experiment.load({ routines: [routine("Chat-match"), routine("Chat"), routine("Debrief")] });

      const rebuilt = routine("Chat-match", { type: "routine-matching" });
      experiment.upsertRoutinesByName([rebuilt]);

      const { routines } = get(experiment);
      expect(routines.map((r) => r.name)).toEqual(["Chat-match", "Chat", "Debrief"]);
      expect(routines[0].type).toBe("routine-matching");
    });

    it("appends routines whose names are not present yet, keeping order", () => {
      experiment.load({ routines: [routine("Consent")] });

      experiment.upsertRoutinesByName([routine("Chat-match"), routine("Chat")]);

      expect(get(experiment).routines.map((r) => r.name)).toEqual(["Consent", "Chat-match", "Chat"]);
    });

    it("is idempotent, so re-applying a block never duplicates the match routine", () => {
      experiment.load({ routines: [] });
      const block = [routine("Chat-match"), routine("Chat"), routine("Chat-end-match")];

      experiment.upsertRoutinesByName(block);
      experiment.upsertRoutinesByName(block);

      expect(get(experiment).routines.map((r) => r.name)).toEqual([
        "Chat-match",
        "Chat",
        "Chat-end-match",
      ]);
    });

    it("notifies subscribers once for the whole batch", () => {
      experiment.load({ routines: [routine("Consent")] });

      let notifications = 0;
      const unsubscribe = experiment.subscribe(() => {
        notifications += 1;
      });
      notifications = 0;

      experiment.upsertRoutinesByName([
        routine("Chat-match"),
        routine("Chat"),
        routine("Chat-end-match"),
      ]);
      unsubscribe();

      expect(notifications).toBe(1);
      expect(get(experiment).dirty).toBe(true);
    });

    it("does not mutate the previous routines array", () => {
      experiment.load({ routines: [routine("Chat")] });
      const before = get(experiment).routines;

      experiment.upsertRoutinesByName([routine("Chat", { type: "routine-video-chat" })]);

      expect(before[0].type).toBe("routine-borderless");
      expect(get(experiment).routines).not.toBe(before);
    });
  });

  describe("markSaved", () => {
    it("clears the dirty flag once a save has landed", () => {
      experiment.load({ routines: [routine("Chat")] });
      experiment.setSessionDesigns([ChatBlock]);
      expect(get(experiment).dirty).toBe(true);

      experiment.markSaved();

      expect(get(experiment).dirty).toBe(false);
    });

    it("keeps everything else, so a save does not discard the edits it just wrote", () => {
      experiment.load({ routines: [routine("Chat")] });
      experiment.setSessionDesigns([ChatBlock]);

      experiment.markSaved();

      const state = get(experiment);
      expect(state.routines.map((r) => r.name)).toEqual(["Chat"]);
      expect(state.sessionDesigns).toEqual([ChatBlock]);
    });

    it("is the only way to clear it: setField cannot, because it forces dirty true", () => {
      experiment.setSessionDesigns([ChatBlock]);

      experiment.setField("dirty", false);

      expect(get(experiment).dirty).toBe(true);
    });
  });

  describe("patchRoutineByName", () => {
    it("merges the patch into the named routine and leaves the others alone", () => {
      experiment.load({ routines: [routine("Chat-match"), routine("Chat")] });

      experiment.patchRoutineByName("Chat", {
        interactionPattern: { type: "round-robin", groupSize: 2 },
      });

      const { routines } = get(experiment);
      expect(routines[1].interactionPattern).toEqual({ type: "round-robin", groupSize: 2 });
      expect(routines[0].interactionPattern).toBeUndefined();
      expect(get(experiment).dirty).toBe(true);
    });

    it("leaves the state untouched when no routine carries that name", () => {
      experiment.load({ routines: [routine("Chat")] });
      const before = get(experiment);

      experiment.patchRoutineByName("Missing", { type: "routine-video-chat" });

      expect(get(experiment)).toBe(before);
      expect(get(experiment).dirty).toBe(false);
    });
  });
});
