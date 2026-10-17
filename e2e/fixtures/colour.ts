/** A colour the suite can tell apart in a video frame. */
export type ColourName = "red" | "green" | "blue" | "other";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * How far the strongest channel must lead the next one. ffmpeg's green is
 * (0, 128, 0), so the margin must stay below 128; compression noise stays far
 * below 60.
 */
const DominanceMargin = 60;

/** Name the dominant channel, or "other" when no channel clearly leads. */
export function nearestColour({ r, g, b }: Rgb): ColourName {
  const ranked = (
    [
      ["red", r],
      ["green", g],
      ["blue", b],
    ] as const
  )
    .slice()
    .sort((x, y) => y[1] - x[1]);
  return ranked[0][1] - ranked[1][1] >= DominanceMargin ? ranked[0][0] : "other";
}
