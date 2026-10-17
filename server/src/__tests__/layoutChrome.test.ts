import { describe, it, expect } from "vitest";
import type {
  RoutineConsentConfig,
  RoutineEndConfig,
  RoutineSurveyConfig,
  RoutineVideoChatConfig,
} from "ame-shared";
import { reservedRegions } from "ame-shared/layout";

describe("reservedRegions", () => {
  it("gives a card routine no chrome: RoutineCard renders no next button", () => {
    // nextButtonMode and nextLabel are dead config — RoutineCard.svelte has no
    // next-button markup at all, so a "Next →" pill in the canvas was a lie.
    expect(reservedRegions("routine-card")).toEqual([]);
    expect(reservedRegions("routine-card", { nextLabel: "Continue" })).toEqual([]);
  });

  it("gives an elements-only survey the Next button it really renders", () => {
    const config: RoutineSurveyConfig = { surveyJson: null };
    expect(reservedRegions("routine-survey", config)).toEqual([
      { id: "next", label: "Next →", slot: "after" },
    ]);
    expect(reservedRegions("routine-survey")).toEqual([
      { id: "next", label: "Next →", slot: "after" },
    ]);
  });

  it("gives a survey with a surveyJson no chrome: the submit belongs to SurveyJS", () => {
    const config: RoutineSurveyConfig = { surveyJson: { elements: [] } };
    expect(reservedRegions("routine-survey", config)).toEqual([]);
  });

  it("gives a consent routine both actions after the grid", () => {
    expect(reservedRegions("routine-consent")).toEqual([
      { id: "agree", label: "I Agree", slot: "after" },
      { id: "disagree", label: "I Do Not Agree", slot: "after" },
    ]);
  });

  it("uses the consent routine's configured labels", () => {
    const config: RoutineConsentConfig = {
      agreeLabel: "Yes, I consent",
      disagreeLabel: "No thank you",
    };
    expect(reservedRegions("routine-consent", config).map((r) => r.label)).toEqual([
      "Yes, I consent",
      "No thank you",
    ]);
  });

  it("gives a debriefing end routine the Finish button it renders", () => {
    // RoutineEnd has no countdown. The region used to claim one, and the canvas
    // drew "Session will complete in 5s..." for a control that never existed.
    expect(reservedRegions("routine-end")).toEqual([
      { id: "finish", label: "Finish", slot: "after" },
    ]);
  });

  it("labels the button Continue when the end routine redirects afterwards", () => {
    const config: RoutineEndConfig = { finishMode: "debrief-redirect" };
    expect(reservedRegions("routine-end", config)).toEqual([
      { id: "finish", label: "Continue →", slot: "after" },
    ]);
  });

  it("reads the inferred finish mode, not just an explicit one", () => {
    const config: RoutineEndConfig = { redirectUrl: "https://example.test/done" };
    expect(reservedRegions("routine-end", config)[0].label).toBe("Continue →");
  });

  it("gives a redirect-only end routine no chrome: it renders nothing at all", () => {
    const config: RoutineEndConfig = { finishMode: "redirect-only" };
    expect(reservedRegions("routine-end", config)).toEqual([]);
  });

  it("ignores the end routine's message: it is not chrome the canvas can place", () => {
    // config.message renders only when the routine has no elements, in which
    // case there is no grid for a region to sit beside.
    const config: RoutineEndConfig = { message: "That is everything." };
    expect(reservedRegions("routine-end", config).map((r) => r.label)).toEqual(["Finish"]);
  });

  it("puts the video panel before the grid so the elements panel follows it", () => {
    expect(reservedRegions("routine-video-chat")).toEqual([
      {
        id: "video-panel",
        label: "Video",
        slot: "before",
        rect: { xPct: 50, yPct: 0, wPct: 50, hPct: 100 },
      },
    ]);
  });

  it("gives the video panel the right half of the stage when elementPosition is 'left'", () => {
    // Explicit "left" must match the undefined-config default above: both are
    // RoutineVideoChat's unmodified two-column grid.
    const config: RoutineVideoChatConfig = { elementPosition: "left" };
    expect(reservedRegions("routine-video-chat", config)[0].rect).toEqual({
      xPct: 50,
      yPct: 0,
      wPct: 50,
      hPct: 100,
    });
  });

  it("gives the video panel the bottom band of the stage when elementPosition is 'top'", () => {
    // elementPosition "top" puts the elements panel in the top (auto) row, so
    // the video panel — the 1fr row — is the band below it.
    const config: RoutineVideoChatConfig = { elementPosition: "top" };
    expect(reservedRegions("routine-video-chat", config)[0].rect).toEqual({
      xPct: 0,
      yPct: 30,
      wPct: 100,
      hPct: 70,
    });
  });

  it("gives the video panel the top band of the stage when elementPosition is 'bottom'", () => {
    // elementPosition "bottom" puts the elements panel in the bottom (auto)
    // row, so the video panel — the 1fr row — is the band above it.
    const config: RoutineVideoChatConfig = { elementPosition: "bottom" };
    expect(reservedRegions("routine-video-chat", config)[0].rect).toEqual({
      xPct: 0,
      yPct: 0,
      wPct: 100,
      hPct: 70,
    });
  });

  it("puts the camera feed before a position check's grid", () => {
    expect(reservedRegions("routine-pos-check")).toEqual([
      {
        id: "camera-feed",
        label: "Camera",
        slot: "before",
        rect: { xPct: 25, yPct: 0, wPct: 50, hPct: 50 },
      },
    ]);
  });

  it("gives a borderless routine no chrome at all", () => {
    expect(reservedRegions("routine-borderless")).toEqual([]);
  });

  it("never labels a region with anything a routine does not render", () => {
    // The regression guard for this whole file: every label below is a literal
    // lifted from the component that draws it.
    const labels = [
      ...reservedRegions("routine-consent"),
      ...reservedRegions("routine-end"),
      ...reservedRegions("routine-survey"),
    ].map((r) => r.label);
    expect(labels).toEqual(["I Agree", "I Do Not Agree", "Finish", "Next →"]);
  });

  it("gives the system matching routines no chrome", () => {
    expect(reservedRegions("routine-matching")).toEqual([]);
    expect(reservedRegions("routine-end-matching")).toEqual([]);
  });

  it("gives button-shaped regions no rect: they sit in the chrome strip, not on the stage", () => {
    const regions = [
      ...reservedRegions("routine-consent"),
      ...reservedRegions("routine-end"),
      ...reservedRegions("routine-survey"),
    ];
    expect(regions.every((r) => r.rect === undefined)).toBe(true);
  });
});
