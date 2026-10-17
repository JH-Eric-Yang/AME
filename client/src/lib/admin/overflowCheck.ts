/**
 * Whether measured content overflows its free-mode box.
 *
 * Heights are explicit in free mode (no z, no auto-grow — see FreePlacement),
 * so authored text can outgrow the box a researcher gave it and the canvas
 * would otherwise clip it in silence. The measurement itself (rendering the
 * element off-screen at its authored width and reading its natural height)
 * has to happen in a component; this module is only the arithmetic that
 * turns two pixel heights into a yes/no, so it is pure and independent of
 * ame-shared and can be tested from the client suite.
 */

/**
 * Tolerance, in pixels, before a content height reads as overflowing.
 * Sub-pixel layout rounding must not trip a false warning.
 */
export const OverflowTolerancePx = 1;

export function isOverflowing(contentHeightPx: number, boxHeightPx: number): boolean {
  return contentHeightPx > boxHeightPx + OverflowTolerancePx;
}
