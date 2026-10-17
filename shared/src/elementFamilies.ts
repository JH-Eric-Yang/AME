import type { ElementType } from "./types";

/**
 * The manuscript groups elements into visual, data and monitoring elements.
 * The interface names the groups Stimulus, Response and Monitor and gives each
 * one shape and one colour (see the --family-* tokens in the root layout):
 * Stimulus = circle, Response = square, Monitor = triangle.
 */
export type ElementFamily = "stimulus" | "response" | "monitor";

/** Display order everywhere a family list appears. */
export const Families: readonly ElementFamily[] = ["stimulus", "response", "monitor"];

export const FamilyLabel: Record<ElementFamily, string> = {
  stimulus: "Stimulus",
  response: "Response",
  monitor: "Monitor",
};

/** Typed over every ElementType, so a new element without a family is a compile error. */
export const FamilyOfElement: Record<ElementType, ElementFamily> = {
  text: "stimulus",
  image: "stimulus",
  video: "stimulus",
  audio: "stimulus",
  "video-chat": "stimulus",
  button: "response",
  recorder: "response",
  "multi-capture": "response",
  "input-textfield": "response",
  "input-select": "response",
  "input-slider": "response",
  "input-option-group": "response",
  "input-file-picker": "response",
  keyboard: "response",
  survey: "response",
  timer: "monitor",
  "body-detector": "monitor",
  "volume-check": "monitor",
  "speech-recognizer": "monitor",
  "facial-expression-detector": "monitor",
};

export function familyOf(type: ElementType): ElementFamily {
  return FamilyOfElement[type];
}
