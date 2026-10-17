import type { ElementConfig, LayoutMode, RoutineLayout, StageRatio } from "../types.js";
import { seedPlacements } from "./defaults.js";

/**
 * The stage a routine is locked to when Free mode is chosen while it is
 * still Fluid. Free placement is a percentage of the stage box, so an
 * unlocked (fluid) stage cannot host it — 16:9 is the common desktop/laptop
 * ratio, and the least surprising thing to lock to automatically.
 */
export const DefaultFreeStage: StageRatio = "16:9";

export interface LayoutModeSwitch {
  layout: RoutineLayout;
  elements: ElementConfig[];
  /** True when this switch had to lock a stage that was previously fluid. */
  stageLocked: boolean;
}

/**
 * Applies a Flow/Free mode change to a routine's layout and elements.
 *
 * Free mode requires a locked stage — a percentage of an unknown box is not
 * reproducible — so switching to Free locks one automatically whenever the
 * routine was fluid (or had none named). Switching to Free also seeds a
 * `placement` for any element that does not already have one, from the
 * rectangle its flow-grid cell occupied, so the switch reads as the layout
 * unlocking rather than collapsing every element to the stage's origin.
 *
 * Switching back to Flow changes only `mode`: placements are left in place
 * (untouched, not cleared) so a later switch back to Free is not a reseed
 * from scratch — flip to free, drag, flip back, flip forward, and everything
 * a researcher positioned by hand is still exactly where they put it.
 */
export function applyLayoutMode(
  layout: RoutineLayout,
  elements: ElementConfig[],
  mode: LayoutMode,
): LayoutModeSwitch {
  if (mode === "flow") {
    return { layout: { ...layout, mode }, elements, stageLocked: false };
  }

  const stageLocked = !layout.stage || layout.stage === "fluid";
  const nextLayout: RoutineLayout = {
    ...layout,
    mode,
    stage: stageLocked ? DefaultFreeStage : layout.stage,
  };

  const seeds = seedPlacements(elements, layout);
  const nextElements = elements.map((el) => {
    if (el.placement || !seeds.has(el.name)) return el;
    return { ...el, placement: seeds.get(el.name)! };
  });

  return { layout: nextLayout, elements: nextElements, stageLocked };
}
