import type {
  RoutineType,
  RoutineSpecificConfig,
  RoutineConsentConfig,
  RoutineEndConfig,
  RoutineSurveyConfig,
  RoutineVideoChatConfig,
  FreePlacement,
} from "../types.js";
import { resolveFinishMode } from "../types.js";

/** Where a reserved region sits relative to the routine's authored grid. */
export type RegionSlot = "before" | "after";

/**
 * A rectangle a routine owns and the researcher cannot author into: the consent
 * actions, the end routine's button, the survey's next, the video panel, the
 * camera feed.
 *
 * Declared once so the builder canvas and the runtime draw the same chrome.
 * CanvasGrid previously invented its own "Built-in" section with labels that
 * could drift from what the routine actually rendered.
 *
 * A routine with no case here has no chrome the canvas can honestly draw.
 * routine-card is one: it renders no next-button markup at all, so its
 * nextButtonMode and nextLabel config drive nothing.
 */
export interface ReservedRegion {
  id: string;
  label: string;
  slot: RegionSlot;
  /**
   * Stage-percent rectangle for free mode, so the no-overlap rule can refuse
   * to author an element underneath a panel that already occupies the stage.
   * Absent for the button-shaped regions (next / agree / disagree / finish):
   * those sit in the chrome strip, not on the stage, so `slot` is all they need.
   *
   * NOT YET CONSUMED. Nothing reads this but its own tests: `resolveDrag`
   * takes no reserved regions and FreeCanvas neither draws them nor feeds them
   * to collision. It waits for the §5.2 stage restructure, which is what gives
   * it something to protect — free placement is currently offered only on
   * routine-borderless (see supportsStage), which has neither a video panel
   * nor a camera feed, so the two routines that declare a rect cannot host a
   * stage at all. Wiring it up before then would be guarding a case that
   * cannot arise; saying so here is preferable to dead code that reads as
   * working.
   */
  rect?: FreePlacement;
}

/**
 * Labels for routine chrome. Every one is the literal a runtime component
 * renders, so a region can never describe a control that does not exist:
 * - AgreeLabel / DisagreeLabel: RoutineConsent.svelte's two action buttons
 * - FinishLabel / ContinueLabel: RoutineEnd.svelte's single button, whose text
 *   depends on whether the routine redirects afterwards
 * - NextLabel: RoutineSurvey.svelte's own submit, in its elements-only mode
 */
const NextLabel = "Next →";
const AgreeLabel = "I Agree";
const DisagreeLabel = "I Do Not Agree";
const FinishLabel = "Finish";
const ContinueLabel = "Continue →";

/**
 * video-panel when `elementPosition` is "left" (the default, unmodified case).
 * RoutineVideoChat.svelte's `.video-chat-layout` is a two-column grid
 * (`grid-template-columns: 1fr 1fr`) with the elements panel authored first,
 * so the video panel is the right half of the stage for its full height.
 */
const VideoPanelSideBySideRect: FreePlacement = { xPct: 50, yPct: 0, wPct: 50, hPct: 100 };

/**
 * Share of stage height the video panel gets when `elementPosition` is "top"
 * or "bottom". In both cases `.video-chat-layout` sizes its two rows
 * `auto 1fr` (or `1fr auto`): the elements panel is the `auto` row, sized to
 * whatever content the researcher authors into it, and the video panel is the
 * `1fr` row that takes the rest. The `auto` row's real height cannot be known
 * here, so this approximates the common case of a compact elements strip and
 * gives the video panel the visually dominant remainder.
 */
const StackedVideoSharePct = 70;

/**
 * The video-panel rect for a given `elementPosition`. "left" is an exact
 * reading of the fixed 1fr/1fr split; "top" and "bottom" swap which end of
 * the stage the (approximated) video panel occupies.
 */
function videoPanelRect(elementPosition: "left" | "top" | "bottom"): FreePlacement {
  switch (elementPosition) {
    // elements panel is the auto row on top; video panel is the 1fr row below.
    case "top":
      return {
        xPct: 0,
        yPct: 100 - StackedVideoSharePct,
        wPct: 100,
        hPct: StackedVideoSharePct,
      };
    // video panel is the 1fr row on top; elements panel is the auto row below.
    case "bottom":
      return { xPct: 0, yPct: 0, wPct: 100, hPct: StackedVideoSharePct };
    case "left":
    default:
      return VideoPanelSideBySideRect;
  }
}

/**
 * camera-feed. RoutinePosCheck.svelte centers a card (`max-width: 600px`)
 * holding a `.video-container` capped at `max-width: 480px` with
 * `aspect-ratio: 4/3`, above the elements grid. At the two desktop stage
 * sizes (`stage.ts`'s 1280x720 "16:9" and 1024x768 "4:3") that container
 * resolves to roughly 37-47% of stage width and 47-50% of stage height,
 * centered horizontally from the top of the stage — this rect is a round,
 * slightly generous reading of both.
 */
const CameraFeedRect: FreePlacement = { xPct: 25, yPct: 0, wPct: 50, hPct: 50 };

export function reservedRegions(
  type: RoutineType,
  config?: RoutineSpecificConfig,
): ReservedRegion[] {
  switch (type) {
    case "routine-survey": {
      const cfg = config as RoutineSurveyConfig | undefined;
      // Only the AME-elements-only fallback renders the routine's own "Next →".
      // With a surveyJson the submit control belongs to SurveyJS, or is the
      // hybrid "Submit All" that appears only once the survey completes —
      // neither of which the canvas models, so declare nothing rather than a
      // button that will not be where the canvas puts it.
      if (cfg?.surveyJson) return [];
      return [{ id: "next", label: NextLabel, slot: "after" }];
    }
    case "routine-consent": {
      const cfg = config as RoutineConsentConfig | undefined;
      return [
        { id: "agree", label: cfg?.agreeLabel ?? AgreeLabel, slot: "after" },
        {
          id: "disagree",
          label: cfg?.disagreeLabel ?? DisagreeLabel,
          slot: "after",
        },
      ];
    }
    case "routine-end": {
      // RoutineEnd renders exactly one control: a button. There is no countdown
      // — a region declaring one described a mockup, not the routine.
      const mode = resolveFinishMode(config as RoutineEndConfig | undefined);
      // redirect-only completes on mount and leaves. It renders an empty
      // aria-busy div: no button, and no elements either.
      if (mode === "redirect-only") return [];
      return [
        {
          id: "finish",
          label: mode === "debrief" ? FinishLabel : ContinueLabel,
          slot: "after",
        },
      ];
    }
    case "routine-video-chat": {
      const cfg = config as RoutineVideoChatConfig | undefined;
      return [
        {
          id: "video-panel",
          label: "Video",
          slot: "before",
          rect: videoPanelRect(cfg?.elementPosition ?? "left"),
        },
      ];
    }
    case "routine-pos-check":
      return [
        { id: "camera-feed", label: "Camera", slot: "before", rect: CameraFeedRect },
      ];
    default:
      return [];
  }
}
