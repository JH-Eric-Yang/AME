import type { ElementConfig, FreePlacement } from "../types.js";
import { hasVisualFootprint } from "../visibility.js";
import { overlaps } from "./free.js";

/**
 * A placed neighbour a candidate placement has to stay clear of, carrying the
 * name so the builder can say WHICH element is in the way.
 */
export interface NeighbourPlacement {
  name: string;
  placement: FreePlacement;
}

/**
 * The placements a candidate must not overlap.
 *
 * Skips the element being placed, anything with no placement of its own, and
 * anything with no visual footprint — §6.1 exempts invisible elements, because
 * requiring a `recorder` not to collide would turn placing one into a packing
 * puzzle for no gain.
 *
 * `include` narrows the set the same way `assign`'s does, and for the same
 * reason: the canvas authors one audience at a time, and two elements shown to
 * different roles never share a screen, so they are allowed to share a
 * rectangle. Every authoring path must pass the same predicate, or the numeric
 * fields will refuse a placement the drag allows.
 */
export function neighbourPlacements(
  elements: ElementConfig[],
  selfIndex: number | null,
  include: (el: ElementConfig) => boolean = () => true,
): NeighbourPlacement[] {
  const neighbours: NeighbourPlacement[] = [];
  elements.forEach((element, index) => {
    if (index === selfIndex) return;
    if (!element.placement) return;
    if (!hasVisualFootprint(element)) return;
    if (!include(element)) return;
    neighbours.push({ name: element.name, placement: element.placement });
  });
  return neighbours;
}

/**
 * The first neighbour a candidate placement would overlap, or null when it is
 * clear.
 *
 * The single gate every authoring path goes through. No-overlap is what lets
 * free placement have no z-order at all (§6.1), and it is enforced at
 * authoring time only — the runtime renders whatever was authored — so a path
 * that clamps and commits without asking this breaks the invariant with
 * nothing downstream to catch it.
 */
export function firstOverlap(
  candidate: FreePlacement,
  neighbours: NeighbourPlacement[],
): NeighbourPlacement | null {
  return neighbours.find((n) => overlaps(candidate, n.placement)) ?? null;
}
