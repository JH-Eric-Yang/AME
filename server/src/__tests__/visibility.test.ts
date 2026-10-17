import { describe, it, expect } from "vitest";
import type { ElementConfig, ElementType, ElementParams } from "ame-shared";
import {
  hasVisualFootprint,
  isPreviewSafe,
  previewSafety,
  previewElement,
  missingContentParam,
} from "ame-shared/visibility";

function el(type: ElementType, params: Partial<ElementParams> = {}): ElementConfig {
  return { name: `${type}-1`, type, params: params as ElementParams };
}

describe("hasVisualFootprint", () => {
  it("treats ordinary visual elements as having a footprint", () => {
    expect(hasVisualFootprint(el("text"))).toBe(true);
    expect(hasVisualFootprint(el("image"))).toBe(true);
    expect(hasVisualFootprint(el("button"))).toBe(true);
    expect(hasVisualFootprint(el("survey"))).toBe(true);
    expect(hasVisualFootprint(el("video-chat"))).toBe(true);
  });

  it("treats volume-check and speech-recognizer as visible: both render a status line", () => {
    expect(hasVisualFootprint(el("volume-check"))).toBe(true);
    expect(hasVisualFootprint(el("speech-recognizer"))).toBe(true);
  });

  it("defaults timer and audio to VISIBLE when the flag is absent", () => {
    expect(hasVisualFootprint(el("timer"))).toBe(true);
    expect(hasVisualFootprint(el("audio"))).toBe(true);
  });

  it("honours the explicit off switch on each of those", () => {
    expect(hasVisualFootprint(el("timer", { visible: false }))).toBe(false);
    expect(hasVisualFootprint(el("audio", { controls: false }))).toBe(false);
  });

  it("always gives a recorder a footprint: no params stop it drawing", () => {
    // ElRecorder renders a Start button whenever autoStart is off, a "REC"
    // indicator whenever it records — that indicator sits OUTSIDE the
    // showStopButton guard — and an upload bar or completion line afterwards.
    expect(hasVisualFootprint(el("recorder"))).toBe(true);
    expect(hasVisualFootprint(el("recorder", { mode: "audio" }))).toBe(true);
    expect(hasVisualFootprint(el("recorder", { showPreview: false }))).toBe(true);
    expect(
      hasVisualFootprint(el("recorder", { mode: "audio", showStopButton: false })),
    ).toBe(true);
    // The configuration the old predicate called weightless while it still
    // rendered a "Start Recording" button.
    expect(
      hasVisualFootprint(
        el("recorder", { showPreview: false, showStopButton: false, autoStart: false }),
      ),
    ).toBe(true);
    // And with autoStart on, the REC indicator and upload bar still draw.
    expect(
      hasVisualFootprint(
        el("recorder", { showPreview: false, showStopButton: false, autoStart: true }),
      ),
    ).toBe(true);
  });

  it("always gives multi-capture a footprint: showPreview gates only its stop button", () => {
    // ElMultiCapture renders a "Connect Your Devices" pane with QR codes before
    // recording and a slot grid during it, whatever showPreview says.
    expect(hasVisualFootprint(el("multi-capture"))).toBe(true);
    expect(hasVisualFootprint(el("multi-capture", { showPreview: false }))).toBe(true);
  });

  it("defaults keyboard and the two detectors to INVISIBLE", () => {
    expect(hasVisualFootprint(el("keyboard"))).toBe(false);
    expect(hasVisualFootprint(el("body-detector"))).toBe(false);
    expect(hasVisualFootprint(el("facial-expression-detector"))).toBe(false);
  });

  it("gives them a footprint once their on-screen part is enabled", () => {
    expect(hasVisualFootprint(el("keyboard", { hint: "Press SPACE" }))).toBe(true);
    expect(hasVisualFootprint(el("body-detector", { showOverlay: true }))).toBe(true);
    expect(
      hasVisualFootprint(el("facial-expression-detector", { showOverlay: true })),
    ).toBe(true);
  });

  it("treats an empty keyboard hint as no hint", () => {
    expect(hasVisualFootprint(el("keyboard", { hint: "" }))).toBe(false);
  });
});

/**
 * Every type the builder can drop. Kept as a literal list rather than derived
 * from the map under test, so a type added to ElementType without a decision
 * here shows up as a missing case, not as a silently smaller sweep.
 */
const AllElementTypes: ElementType[] = [
  "text",
  "image",
  "video",
  "audio",
  "button",
  "recorder",
  "multi-capture",
  "input-textfield",
  "input-select",
  "input-slider",
  "timer",
  "body-detector",
  "volume-check",
  "speech-recognizer",
  "video-chat",
  "keyboard",
  "input-option-group",
  "input-file-picker",
  "survey",
  "facial-expression-detector",
];

describe("previewSafety", () => {
  it("refuses every type whose onMount touches camera, mic or MediaPipe", () => {
    for (const type of [
      "recorder",
      "multi-capture",
      "body-detector",
      "facial-expression-detector",
      "speech-recognizer",
      "volume-check",
    ] as ElementType[]) {
      expect(previewSafety(type)).toBe("hardware");
      expect(isPreviewSafe(type)).toBe(false);
    }
  });

  it("refuses the types whose onMount fires experiment events", () => {
    // ElKeyboard installs a window keydown listener; ElTimer starts an
    // interval that fires timeout — proceed and complete included.
    expect(previewSafety("keyboard")).toBe("runtime-only");
    expect(previewSafety("timer")).toBe("runtime-only");
  });

  it("allows the purely presentational and input types", () => {
    for (const type of [
      "text",
      "image",
      "video",
      "audio",
      "button",
      "video-chat",
      "input-textfield",
      "input-select",
      "input-slider",
      "input-option-group",
      "input-file-picker",
      "survey",
    ] as ElementType[]) {
      expect(isPreviewSafe(type)).toBe(true);
    }
  });

  it("has a verdict for every element type", () => {
    for (const type of AllElementTypes) {
      expect(previewSafety(type)).toMatch(/^(safe|hardware|runtime-only)$/);
    }
  });
});

describe("previewElement", () => {
  it("turns autoplay off for audio and video", () => {
    const audio = el("audio", { autoplay: true, loop: true });
    const preview = previewElement(audio);
    expect((preview.params as { autoplay?: boolean }).autoplay).toBe(false);
    // Everything else about the element survives.
    expect((preview.params as { loop?: boolean }).loop).toBe(true);
    expect(preview.name).toBe(audio.name);
    expect(preview.type).toBe("audio");
  });

  it("never mutates the stored params", () => {
    const video = el("video", { autoplay: true });
    previewElement(video);
    expect((video.params as { autoplay?: boolean }).autoplay).toBe(true);
  });

  it("returns an untimed, non-media element by identity", () => {
    for (const type of AllElementTypes.filter((t) => t !== "audio" && t !== "video")) {
      const original = el(type);
      expect(previewElement(original)).toBe(original);
    }
  });

  /**
   * TimedElement measures against the participant's routineStartTime. The
   * builder has none, so an element with a duration reads as already expired
   * and disappears from the canvas the researcher is arranging.
   */
  it("strips the timing that would make ElementRenderer hide the element", () => {
    const timed: ElementConfig = {
      ...el("text", { content: "hello" }),
      onsetTime: 5000,
      duration: 2000,
      disappearMode: "removed",
    };
    const preview = previewElement(timed);
    expect(preview.onsetTime).toBeUndefined();
    expect(preview.duration).toBeUndefined();
    expect(preview.disappearMode).toBeUndefined();
    expect((preview.params as { content?: string }).content).toBe("hello");
    // The authored element still carries its timing.
    expect(timed.onsetTime).toBe(5000);
  });

  it("strips timing and autoplay together", () => {
    const preview = previewElement({
      ...el("video", { autoplay: true }),
      duration: 3000,
    });
    expect(preview.duration).toBeUndefined();
    expect((preview.params as { autoplay?: boolean }).autoplay).toBe(false);
  });
});

describe("missingContentParam", () => {
  it("names the parameter a freshly dropped element still needs", () => {
    // Every element is dropped on the canvas with params: {}.
    expect(missingContentParam(el("text"))).toBe("content");
    expect(missingContentParam(el("image"))).toBe("src");
    expect(missingContentParam(el("video"))).toBe("src");
    expect(missingContentParam(el("audio"))).toBe("src");
    expect(missingContentParam(el("survey"))).toBe("surveyJson");
    expect(missingContentParam(el("input-select"))).toBe("options");
    expect(missingContentParam(el("input-option-group"))).toBe("options");
  });

  it("clears once the parameter is authored", () => {
    expect(missingContentParam(el("text", { content: "Welcome" }))).toBeNull();
    expect(missingContentParam(el("image", { src: "asset:abc" }))).toBeNull();
    expect(missingContentParam(el("survey", { surveyJson: { pages: [] } }))).toBeNull();
    expect(
      missingContentParam(el("input-select", { options: [{ label: "A", value: "a" }] })),
    ).toBeNull();
  });

  it("treats an empty options list as no options", () => {
    expect(missingContentParam(el("input-option-group", { options: [] }))).toBe("options");
  });

  it("asks nothing of types whose defaults are sufficient", () => {
    // A button with no label says "Continue"; a textfield with no placeholder
    // is still a usable textfield.
    for (const type of AllElementTypes.filter(
      (t) =>
        !["text", "image", "video", "audio", "survey", "input-select", "input-option-group"].includes(
          t,
        ),
    )) {
      expect(missingContentParam(el(type))).toBeNull();
    }
  });
});
