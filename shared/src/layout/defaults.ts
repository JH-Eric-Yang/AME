import type {
  CellAlign,
  ElementConfig,
  FreePlacement,
  RoutineLayout,
  RoutineType,
} from "../types.js";
import { DefaultPadding } from "./flow.js";
import { cellKey, positionInRange } from "./assign.js";

/** Columns in a row, matching the flow grid's twelfths. */
const GridColumns = 12;

/**
 * Routines that wrap their grid in a card. The card supplies its own padding
 * from its config, so the grid inside it adds none of its own.
 */
const CardFamilyRoutines: readonly RoutineType[] = [
  "routine-card",
  "routine-consent",
  "routine-survey",
  "routine-end",
];

/** The padding a card-family routine's grid gets: the card already has some. */
export const CardGridPadding = "0";

export function isCardFamily(type: RoutineType | undefined): boolean {
  return type !== undefined && CardFamilyRoutines.includes(type);
}

/**
 * The grid padding a routine renders with when its layout names none.
 *
 * The builder's Inspector shows this as the Gap/Padding field's stand-in value,
 * so a researcher is never told a default that is not what renders.
 */
export function defaultPadding(type: RoutineType | undefined): string {
  return isCardFamily(type) ? CardGridPadding : DefaultPadding;
}

/**
 * How a routine type aligns elements across their cell.
 *
 * Only routine-borderless differs: nothing wraps its elements, so the grid must
 * centre each one itself — the centring the flat stack it replaced applied via
 * .element-wrapper. This was previously a `cellAlign` field on RoutineLayout,
 * which put a private default in a public persisted type (serialised into the
 * routines JSON column and carried through export/import) with no Inspector
 * control behind it, written twice as a bare "center" literal with nothing
 * keeping the two copies in sync.
 */
export function defaultCellAlign(type: RoutineType | undefined): CellAlign {
  return type === "routine-borderless" ? "center" : "stretch";
}

/**
 * Routine types whose surface IS the stage, and which can therefore host a
 * locked ratio and free placement.
 *
 * Spec §5.2 says a stage resolves to the card for the card family, and to the
 * viewport with the video panel or camera feed as a reserved region for the
 * other two. None of that is built: LayoutStage mounts wherever LayoutGrid
 * already sat — inside .elements-panel at half the viewport for video chat,
 * below the camera inside a card for pos-check, inside a 600px card for the
 * card family. A locked 16:9 stage there is a 1280px layout box inside a 600px
 * card, which is a wrong result, not a rough one. So the control is offered
 * only where the stage genuinely is the whole surface; the rest wait for the
 * §5.2 restructure.
 */
const StageSurfaceRoutines: readonly RoutineType[] = ["routine-borderless"];

/** Routine types that render no authored elements at all. */
const ElementlessRoutines: readonly RoutineType[] = [
  "routine-matching",
  "routine-end-matching",
];

/** Whether a routine type can host a locked stage and free placement. */
export function supportsStage(type: RoutineType): boolean {
  return StageSurfaceRoutines.includes(type);
}

/**
 * Why a routine type cannot host a stage, in the researcher's terms, or null
 * when it can. Said plainly in the Inspector rather than leaving the control
 * there to produce a wrong layout.
 */
export function stageUnavailableReason(type: RoutineType): string | null {
  if (supportsStage(type)) return null;
  if (ElementlessRoutines.includes(type)) {
    return "This routine renders no authored elements, so there is no surface to place any on.";
  }
  return (
    "This routine lays its elements out inside its own chrome — a card, the video panel, " +
    "the camera feed — rather than across the whole screen, so a locked stage would be a " +
    "fixed-size box inside a box that is not it. Borderless is the only type whose surface " +
    "is the stage today."
  );
}

/**
 * A routine's authored layout with its type's defaults filled in.
 *
 * The one place a routine type's geometry defaults are resolved, so the builder
 * canvas and the runtime cannot disagree about them: both call this before
 * containerStyle. Only a value the layout itself names survives.
 */
export function resolvedLayout(
  layout: RoutineLayout,
  type: RoutineType | undefined,
): RoutineLayout {
  return { ...layout, padding: layout.padding ?? defaultPadding(type) };
}

/**
 * The placements a routine's elements take when its surface first flips from
 * flow to free: each element keeps the rectangle its grid cell occupied, so
 * the switch reads as the layout unlocking rather than collapsing.
 *
 * Elements sharing one cell split it vertically, because two elements stacked
 * in a flow cell must not seed on top of each other — overlap is forbidden.
 *
 * An element whose `position` names a cell the layout does not have gets NO
 * seed, so it lands in `assign()`'s `unplaced` bucket and appears in the "Not
 * placed" strip. Out-of-range positions are reachable — `experiment.updateRow`
 * replaces a row's `columns` wholesale with no position fixup, and
 * `handleRemoveRow` shifts rows underneath one another — and deriving a
 * rectangle from one produces a box off the stage (column 2 of a row retyped
 * to a single column seeds `{ xPct: 100, wPct: 100 }`; row 3 of a two-row
 * layout seeds `{ yPct: 150 }`). Clamping such a box back onto the stage would
 * be worse than not seeding it: it silently moves the element to a position
 * the researcher never authored, on top of whatever is already there — and
 * §6.1's no-overlap invariant is exactly what lets this feature have no
 * z-order. Skipping surfaces the element instead, which is §1.3's rule:
 * nothing is ever silently invisible, and nothing is silently relocated
 * either. The researcher drags it back onto the stage from the strip.
 *
 * The invariant, stated once: this seeds exactly the elements `assign()`
 * would render into a cell.
 */
export function seedPlacements(
  elements: ElementConfig[],
  layout: RoutineLayout,
): Map<string, FreePlacement> {
  const rowCount = layout.rows.length || 1;
  const rowHeight = 100 / rowCount;

  // Group by cell first: how many share a cell decides how tall each one is.
  const byCell = new Map<string, ElementConfig[]>();
  for (const el of elements) {
    if (!el.position || !positionInRange(el.position, layout)) continue;
    const key = cellKey(el.position.row, el.position.column);
    const bucket = byCell.get(key);
    if (bucket) bucket.push(el);
    else byCell.set(key, [el]);
  }

  const seeds = new Map<string, FreePlacement>();
  byCell.forEach((cellElements) => {
    cellElements
      .slice()
      .sort((a, b) => (a.position?.order ?? 0) - (b.position?.order ?? 0))
      .forEach((el, index) => {
        // Every element here passed positionInRange, so the row and the
        // column it names both exist.
        const { row, column } = el.position!;
        const columns = layout.rows[row]!.columns;
        const before = columns
          .slice(0, column)
          .reduce((sum, c) => sum + c.span, 0);
        const span = columns[column]!.span;
        const share = rowHeight / cellElements.length;
        seeds.set(el.name, {
          xPct: (before / GridColumns) * 100,
          wPct: (span / GridColumns) * 100,
          yPct: row * rowHeight + index * share,
          hPct: share,
        });
      });
  });

  return seeds;
}
