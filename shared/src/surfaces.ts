import type { ElementType } from "./types.js";

/**
 * Which of a participant's screens an element is on.
 *
 * Absent means "screen": every element authored before the phone existed
 * belongs on the desktop, and nothing needs migrating.
 */
export type ElementSurface = "screen" | "device";

export function elementSurface(el: { surface?: ElementSurface }): ElementSurface {
  return el.surface ?? "screen";
}

/** Whether this element belongs on the given surface. */
export function isOnSurface(
  el: { surface?: ElementSurface },
  surface: ElementSurface,
): boolean {
  return elementSurface(el) === surface;
}

/**
 * What a handset can render.
 *
 * The phone's camera is already committed to its capture mode, so the
 * camera-bound types are not merely unstyled there — they cannot work at all.
 * `survey` is a desktop-sized layout, and `speech-recognizer` acts on
 * `params.action` rather than the events array, so a phone press means nothing
 * to it.
 */
export const HandsetTypes = [
  "text",
  "image",
  "button",
  "input-option-group",
  "input-slider",
  "input-textfield",
  "timer",
] as const satisfies readonly ElementType[];

export function canRenderOnHandset(type: ElementType): boolean {
  return (HandsetTypes as readonly ElementType[]).includes(type);
}
