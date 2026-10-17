import type { ElementType } from "ame-shared";

/**
 * Which e2e tests cover each element type. `file` is relative to e2e/, and each
 * title must appear in that file. `pending` names the phase or task that adds
 * the tests; phase 6 removes the last pending entry.
 *
 * Typed Record<ElementType, …>, so a new element type without an entry is a
 * compile error in an editor, and coverage.spec.ts fails at runtime.
 */
export type Coverage = { file: string; titles: string[] } | { pending: string };

const Response = "elements/response.spec.ts";
const Stimulus = "elements/stimulus.spec.ts";
const Monitor = "elements/monitor.spec.ts";

export const ElementCoverage: Record<ElementType, Coverage[]> = {
  text: [{ file: Stimulus, titles: ["text appears at its onset time and leaves after its duration"] }],
  image: [{ file: Stimulus, titles: ["image loads its source"] }],
  video: [
    {
      file: Stimulus,
      titles: [
        "video plays on its own when autoplay is set",
        "video without autoplay stays paused",
        "video shows controls only when controls is set",
      ],
    },
  ],
  audio: [
    { file: Stimulus, titles: ["audio plays on its own after the participant has clicked"] },
    {
      file: "elements/stimulus-blocked.spec.ts",
      titles: ["audio shows a Play button when the browser blocks autoplay and controls are off"],
    },
  ],
  button: [{ file: Response, titles: ["button records its value and proceeds"] }],
  recorder: [{ pending: "phase 3" }],
  "multi-capture": [{ pending: "phase 3" }],
  "input-textfield": [
    {
      file: Response,
      titles: ["textfield records typed text", "textfield records its default when the participant does not type"],
    },
  ],
  "input-select": [
    {
      file: Response,
      titles: [
        "a select's change trigger proceeds and records the choice",
        "select and option group record their defaults",
      ],
    },
    { file: "builder-options.spec.ts", titles: ["the Options field keeps options typed one key at a time"] },
  ],
  "input-slider": [
    {
      file: Response,
      titles: [
        "slider records the value set with the arrow keys",
        "slider records its default when the participant does not move it",
        "slider records the value set by a drag to the end",
      ],
    },
  ],
  timer: [
    { file: Monitor, titles: ["timer counts down and its timeout proceeds"] },
    {
      file: "timer-units.spec.ts",
      titles: [
        "a timer of 3 s ends after about 3 seconds",
        "the Inspector gives the timer Duration in seconds [E2E-D6]",
        "a timer dropped without a Duration counts down from 60 seconds [E2E-D7]",
      ],
    },
  ],
  "body-detector": [{ pending: "phase 5" }],
  "volume-check": [
    {
      file: Monitor,
      titles: [
        "volume check passes on the fake microphone noise and releases the microphone",
        "volume check with an unreachable threshold does not pass",
      ],
    },
  ],
  "speech-recognizer": [
    { file: Monitor, titles: ["speech recognizer fires its keyword trigger and records the transcript"] },
  ],
  "video-chat": [{ pending: "phase 4" }],
  keyboard: [
    {
      file: Response,
      titles: [
        "keyboard element records a keypress and its press trigger proceeds",
        "keyboard element ignores keys outside the allowlist",
      ],
    },
  ],
  "input-option-group": [
    {
      file: Response,
      titles: [
        "option group records radio and checkbox answers",
        "checkbox group deselects on a second click",
        "select and option group record their defaults",
      ],
    },
  ],
  "input-file-picker": [{ file: Response, titles: ["file picker uploads the chosen file through tus"] }],
  survey: [{ file: Response, titles: ["survey element renders SurveyJS and proceeds on submit"] }],
  "facial-expression-detector": [{ pending: "phase 5" }],
};
