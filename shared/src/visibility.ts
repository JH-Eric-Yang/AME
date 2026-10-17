import type { ElementConfig, ElementParams, ElementType } from "./types.js";

/**
 * Whether an element occupies space in the layout.
 *
 * Read from the components, not the param interfaces: the interfaces make every
 * flag optional and state no default, and most of these default to visible.
 * An element with no footprint still mounts and still records — it is
 * weightless, not absent.
 *
 * Four types are deliberately absent from this switch, because nothing they
 * expose can make them stop drawing:
 * - volume-check and speech-recognizer render a status line unconditionally.
 * - recorder renders a Start button whenever autoStart is off, a "REC"
 *   indicator whenever it is recording — outside the showStopButton guard,
 *   which covers only the stop button — and an upload bar, completion line or
 *   retry panel afterwards. There is no combination of its params that leaves
 *   it drawing nothing at any point in its lifecycle.
 * - multi-capture renders a "Connect Your Devices" pane with QR codes before
 *   recording and a slot grid during it; showPreview gates only its stop
 *   button.
 */
export function hasVisualFootprint(el: ElementConfig): boolean {
  const p = el.params as Record<string, unknown>;
  switch (el.type) {
    case "keyboard":
      // ElKeyboard renders only its optional prompt.
      return Boolean(p.hint);
    case "body-detector":
    case "facial-expression-detector":
      // Without the overlay the detector is clip-path hidden and takes no space.
      return p.showOverlay === true;
    case "timer":
      return p.visible !== false;
    case "audio":
      return p.controls !== false;
    default:
      return true;
  }
}

/**
 * Why the builder canvas may not mount a type's real component.
 *
 * - `"safe"` — mount it. Nothing happens on mount but rendering.
 * - `"hardware"` — mounting turns on the researcher's camera, microphone or
 *   speech recogniser, or downloads a MediaPipe model, while they are merely
 *   laying out a screen. This is the reason this rule exists at all.
 * - `"runtime-only"` — mounting installs a listener or a timer that fires
 *   real experiment events (`proceed`, `timeout`) into the runner store. In
 *   the builder that is both wrong and invisible.
 */
export type PreviewSafety = "safe" | "hardware" | "runtime-only";

/**
 * Whether the builder canvas can mount an element type's real runtime
 * component, and if not, why.
 *
 * Derived from what each component does on mount, not from what it draws:
 *
 * - recorder, multi-capture, body-detector, facial-expression-detector call
 *   `getUserMedia` (and multi-capture also opens `RTCPeerConnection`s and a
 *   socket) from `onMount`.
 * - volume-check calls `getUserMedia` and opens an `AudioContext` from
 *   `onMount`.
 * - speech-recognizer starts `SpeechRecognition` from `onMount`, which in
 *   Chrome prompts for the microphone.
 * - keyboard's `onMount` adds a `window` keydown listener that records
 *   presses and fires the element's declared events.
 * - timer's `onMount` starts an interval that fires `timeout` events —
 *   `proceed`/`complete` included — when it runs out.
 *
 * The map is exhaustive over `ElementType` on purpose: a new element type is a
 * compile error here, so somebody has to decide whether mounting it in an
 * authoring tool is safe rather than inheriting a default that might switch a
 * camera on.
 */
const PreviewSafetyByType: Record<ElementType, PreviewSafety> = {
  text: "safe",
  image: "safe",
  video: "safe",
  audio: "safe",
  button: "safe",
  "video-chat": "safe",
  "input-textfield": "safe",
  "input-select": "safe",
  "input-slider": "safe",
  "input-option-group": "safe",
  "input-file-picker": "safe",
  survey: "safe",
  recorder: "hardware",
  "multi-capture": "hardware",
  "body-detector": "hardware",
  "facial-expression-detector": "hardware",
  "speech-recognizer": "hardware",
  "volume-check": "hardware",
  keyboard: "runtime-only",
  timer: "runtime-only",
};

export function previewSafety(type: ElementType): PreviewSafety {
  return PreviewSafetyByType[type];
}

export function isPreviewSafe(type: ElementType): boolean {
  return previewSafety(type) === "safe";
}

/**
 * The element to hand a preview renderer, given the authored one.
 *
 * Two things are neutralised, both of which are about time rather than shape:
 *
 * - `audio` and `video` honour `params.autoplay`, and a canvas that starts
 *   playing a stimulus the moment a researcher scrolls past it is wrong. The
 *   copy returned here turns autoplay off.
 * - `onsetTime` / `duration` / `disappearMode` drive ElementRenderer's
 *   TimedElement wrapper, which is a runtime device: it measures against the
 *   participant's `routineStartTime`, and in the builder there is none, so an
 *   element with a duration would count as already expired and vanish from the
 *   canvas. On an authoring surface every element is shown; when it appears
 *   and for how long is the Inspector's business.
 *
 * The stored params are never touched, so the researcher's next save cannot
 * silently rewrite what they authored. An element that needs neither change is
 * returned by identity, so the canvas re-renders no more often than the
 * authored element does.
 */
export function previewElement(el: ElementConfig): ElementConfig {
  const timed = el.onsetTime != null || el.duration != null;
  const media = el.type === "audio" || el.type === "video";
  if (!timed && !media) return el;

  const preview: ElementConfig = { ...el };
  if (timed) {
    delete preview.onsetTime;
    delete preview.duration;
    delete preview.disappearMode;
  }
  if (media) {
    preview.params = { ...el.params, autoplay: false } as ElementParams;
  }
  return preview;
}

/**
 * The parameter an element still needs before it shows a participant
 * anything, or null when it is ready to render.
 *
 * A new element is dropped on the canvas with `params: {}`, and for these
 * types that means the real component renders an empty box: ElText emits an
 * empty div, ElImage an `<img>` with no source, ElInputSelect a lone
 * placeholder. Nothing is broken — there is simply nothing authored yet — but
 * on a canvas an empty box and a working element look identical, which is how
 * a freshly dropped Text element came to look like a failed drop.
 *
 * So the builder says which parameter is missing instead of rendering the
 * emptiness. The runtime deliberately does NOT: a participant must never be
 * shown "no content yet", and an element the researcher left blank must take
 * up exactly the space it will take up. That is why this lives here, next to
 * the other builder-facing predicates, and not inside the components.
 *
 * Only parameters with no sensible default are listed. A button with no label
 * says "Continue", a textfield with no placeholder is still a usable
 * textfield — neither is missing anything.
 */
export function missingContentParam(el: ElementConfig): string | null {
  const p = el.params as Record<string, unknown>;
  switch (el.type) {
    case "text":
      return p.content ? null : "content";
    case "image":
    case "video":
    case "audio":
      return p.src ? null : "src";
    case "survey":
      return p.surveyJson ? null : "surveyJson";
    case "input-select":
    case "input-option-group":
      return Array.isArray(p.options) && p.options.length > 0 ? null : "options";
    default:
      return null;
  }
}
