import { describe, it, expect } from "vitest";
import type { CompiledBlock, SessionDesignIssue } from "ame-shared/sessionDesign";
import { describeApplyBar, describePattern, splitIssueMessage } from "$lib/admin/applyBarView";

type ContentRow = CompiledBlock["contentRows"][number];

const BlockId = "blk1";

/** The Builder before the block's first apply: it holds the trial routine only. */
const BuilderBeforeApply = ["Consent", "Chat"];

/** The Builder after one apply: all three of the block's routines exist. */
const BuilderAfterApply = ["Consent", "Chat-match", "Chat", "Chat-end-match"];

function contentRow(index: number): ContentRow {
  return {
    progress: index + 1,
    trialNumber: Math.max(1, index),
    routine: "Chat",
    condition: "Basic",
    content: {},
    description: `block:${BlockId}:${index}`,
  };
}

/** The canonical 8 seats / dyads / 7 trials block: 1 match + 7 trials + 1 end = 9 rows. */
function compiledFixture(): CompiledBlock {
  return {
    routines: [
      {
        name: "Chat-match",
        type: "routine-matching",
        layout: { rows: [] },
        elements: [],
        matching: {
          strategy: "fifo",
          slots: Array.from({ length: 8 }, (_, i) => ({ name: `Seat ${i + 1}` })),
          timeout: 300,
          timeoutAction: "wait",
        },
      },
      {
        name: "Chat",
        type: "routine-video-chat",
        layout: { rows: [] },
        elements: [],
        matching: null,
        interactionPattern: { type: "round-robin", groupSize: 2 },
      },
      {
        name: "Chat-end-match",
        type: "routine-end-matching",
        layout: { rows: [] },
        elements: [],
        matching: null,
      },
    ],
    contentRows: Array.from({ length: 9 }, (_, i) => contentRow(i)),
    band: { fromProgress: 1, toProgress: 9, conditions: ["Basic"], blockId: BlockId },
    participantsPerSession: 8,
  };
}

/**
 * The blocking message exactly as validateSessionDesign emits it: the failure,
 * then the remedy, then the consequence of leaving it alone.
 */
const CohortError: SessionDesignIssue = {
  level: "error",
  field: "cohortSize",
  message:
    "A cohort of 7 cannot be split into groups of 2. Use an even cohort, or a group size that divides it. Left alone, the schedule would quietly put all seven in one call.",
};

describe("describeApplyBar", () => {
  describe("READY", () => {
    it("names each routine the block writes, creating the two it invents", () => {
      const view = describeApplyBar(compiledFixture(), [], "idle", BuilderBeforeApply);

      expect(view.status).toBe("ready");
      expect(view.items).toEqual([
        { verb: "+", name: "Chat-match", detail: "(routine-matching, 8 seats)" },
        { verb: "~", name: "Chat", detail: "(round-robin, dyads)" },
        { verb: "+", name: "Chat-end-match", detail: "" },
      ]);
    });

    it("rewrites rather than creates when the Builder already holds the routines", () => {
      const view = describeApplyBar(compiledFixture(), [], "idle", BuilderAfterApply);

      expect(view.items.map((item) => item.verb)).toEqual(["~", "~", "~"]);
    });

    it("summarises rows, progress band, condition and the participants-per-session write", () => {
      const view = describeApplyBar(compiledFixture(), [], "idle", BuilderBeforeApply);

      expect(view.summary).toBe(
        "9 content rows, progress 1–9, condition Basic · sets Participants Per Session to 8",
      );
      expect(view.detail).toBeNull();
      expect(view.action).toEqual({ kind: "apply", label: "Generate & Save", disabled: false });
    });

    it("pluralises the condition list", () => {
      const compiled = compiledFixture();
      compiled.band.conditions = ["Basic", "Extra"];

      expect(describeApplyBar(compiled, [], "idle", BuilderBeforeApply).summary).toContain(
        "conditions Basic, Extra",
      );
    });

    it("is not blocked by warnings", () => {
      const warning: SessionDesignIssue = {
        level: "warning",
        message: 'Condition "Pilot" is not one of the experiment\'s conditions.',
      };

      expect(describeApplyBar(compiledFixture(), [warning], "idle", BuilderBeforeApply).status).toBe(
        "ready",
      );
    });
  });

  describe("BLOCKED", () => {
    it("puts the failing rule on the button's own row and disables the button", () => {
      const view = describeApplyBar(compiledFixture(), [CohortError], "idle", BuilderBeforeApply);

      expect(view.status).toBe("blocked");
      expect(view.summary).toBe("A cohort of 7 cannot be split into groups of 2.");
      expect(view.detail).toBe(
        "Use an even cohort, or a group size that divides it. Left alone, the schedule would quietly put all seven in one call.",
      );
      expect(view.action).toEqual({ kind: "apply", label: "Generate & Save", disabled: true });
    });

    it("drops the compile plan, so the reason is the only thing on the row", () => {
      expect(
        describeApplyBar(compiledFixture(), [CohortError], "idle", BuilderBeforeApply).items,
      ).toEqual([]);
    });

    it("counts the errors it is not showing", () => {
      const second: SessionDesignIssue = {
        level: "error",
        message: 'Seat 3 ("Listener") has no property filters.',
      };
      const view = describeApplyBar(
        compiledFixture(),
        [CohortError, second],
        "idle",
        BuilderBeforeApply,
      );

      expect(view.detail).toBe(
        "Use an even cohort, or a group size that divides it. Left alone, the schedule would quietly put all seven in one call. 1 more problem must be fixed first.",
      );
    });

    it("uses the whole message as the headline when it is one sentence", () => {
      const single: SessionDesignIssue = {
        level: "error",
        message: "A cohort needs at least 2 seats",
      };
      const view = describeApplyBar(compiledFixture(), [single], "idle", BuilderBeforeApply);

      expect(view.summary).toBe("A cohort needs at least 2 seats");
      expect(view.detail).toBeNull();
    });
  });

  describe("APPLYING", () => {
    it("keeps the plan visible and locks the button", () => {
      const view = describeApplyBar(compiledFixture(), [], "applying", BuilderAfterApply);

      expect(view.status).toBe("applying");
      expect(view.items).toHaveLength(3);
      expect(view.action).toEqual({ kind: "apply", label: "Saving…", disabled: true });
    });
  });

  describe("APPLIED", () => {
    it("reports the row count and offers View in Content", () => {
      const view = describeApplyBar(compiledFixture(), [], "applied", BuilderAfterApply);

      expect(view.status).toBe("applied");
      expect(view.summary).toBe("Applied · 9 rows written");
      expect(view.detail).toBeNull();
      expect(view.action).toEqual({
        kind: "view-content",
        label: "View in Content",
        disabled: false,
      });
    });
  });

  describe("PARTIAL FAILURE", () => {
    it("says exactly what was and was not written, and offers a retry", () => {
      const view = describeApplyBar(compiledFixture(), [], "routines-only", BuilderAfterApply);

      expect(view.status).toBe("routines-only");
      expect(view.summary).toBe("Routines saved — content upload failed.");
      expect(view.detail).toBe(
        "The block's routines are on the experiment; its content rows are not. Nothing else was touched.",
      );
      expect(view.action).toEqual({ kind: "retry-upload", label: "Retry upload", disabled: false });
    });

    it("still reports the outcome when an error issue is also present", () => {
      expect(
        describeApplyBar(compiledFixture(), [CohortError], "routines-only", BuilderAfterApply)
          .status,
      ).toBe("routines-only");
    });
  });
});

describe("describePattern", () => {
  it("names the small group sizes with the schedule pane's own words", () => {
    expect(describePattern({ type: "round-robin", groupSize: 2 })).toBe("round-robin, dyads");
    expect(describePattern({ type: "round-robin", groupSize: 3 })).toBe("round-robin, triads");
  });

  it("falls back to a count for larger groups", () => {
    expect(describePattern({ type: "round-robin", groupSize: 6 })).toBe("round-robin, groups of 6");
  });

  it("describes the other pattern types", () => {
    expect(describePattern({ type: "all" })).toBe("everyone together");
    expect(
      describePattern({
        type: "fixed",
        groups: [
          [0, 1],
          [2, 3],
        ],
      }),
    ).toBe("fixed groups (2)");
    expect(describePattern({ type: "sequence", steps: [[[0, 1]], [[0, 2]]] })).toBe(
      "explicit table, 2 trials",
    );
    expect(describePattern(undefined)).toBe("no rotation");
  });
});

describe("splitIssueMessage", () => {
  it("splits the explanatory remainder off the headline", () => {
    expect(splitIssueMessage("Too few seats. Add at least two.")).toEqual({
      headline: "Too few seats.",
      detail: "Add at least two.",
    });
  });

  it("leaves a single sentence whole", () => {
    expect(splitIssueMessage("Too few seats")).toEqual({ headline: "Too few seats", detail: null });
  });
});

describe("a write already in flight", () => {
  it("locks the button even after an edit has reset the state to idle", () => {
    // C1: an edit mid-write calls updateDesign, which sets `idle`. Without the
    // in-flight flag the bar would re-enable Generate & Save over a sequence
    // that is still running, and a second press would race the first.
    const view = describeApplyBar(compiledFixture(), [], "idle", BuilderAfterApply, true);

    expect(view.action.disabled).toBe(true);
    expect(view.action.label).toBe("Saving…");
  });

  it("locks the Retry upload button too", () => {
    const view = describeApplyBar(
      compiledFixture(),
      [],
      "routines-only",
      BuilderAfterApply,
      true,
    );

    expect(view.action.kind).toBe("retry-upload");
    expect(view.action.disabled).toBe(true);
  });

  it("leaves View in Content alone, because it navigates rather than writes", () => {
    const view = describeApplyBar(compiledFixture(), [], "applied", BuilderAfterApply, true);

    expect(view.action.kind).toBe("view-content");
    expect(view.action.disabled).toBe(false);
  });

  it("keeps the button enabled when no write is running", () => {
    expect(
      describeApplyBar(compiledFixture(), [], "idle", BuilderAfterApply, false).action.disabled,
    ).toBe(false);
  });

  it("leaves a blocked design blocked, whatever the flag says", () => {
    expect(
      describeApplyBar(compiledFixture(), [CohortError], "idle", BuilderAfterApply, false).action
        .disabled,
    ).toBe(true);
  });
});
