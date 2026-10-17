import type { ElementType } from "./types";

export interface ParamInfo {
  description: string;
  type: string;
  required?: boolean;
  default?: string;
  options?: string[];
  /** Holds a stimulus rather than a style; a starter CSV gives it a column. */
  stimulus?: true;
}

export type ElementParamHelp = Record<string, ParamInfo>;

const parameterHelp: Record<ElementType, ElementParamHelp> = {
  text: {
    content: {
      description:
        "The text to display. Rendered as HTML, so inline tags are allowed. `{{ref:self/p0/name}}` inserts a value collected at an earlier step.",
      type: "string",
      required: true,
      stimulus: true,
    },
    fontFamily: {
      description: "CSS font-family. The builder offers Sans, Serif and Monospace presets, or a custom stack.",
      type: "string",
      default: "inherited",
    },
    fontSize: {
      description: "CSS font size (e.g. '16px', '1.2rem'). The builder edits it in px.",
      type: "string",
      default: "14px",
    },
    fontWeight: {
      description: "CSS font weight.",
      type: "string",
      default: "normal",
      options: ["normal", "500", "600", "bold"],
    },
    fontStyle: {
      description: "Upright or italic.",
      type: "string",
      default: "normal",
      options: ["normal", "italic"],
    },
    lineHeight: {
      description: "Unitless line-height multiplier.",
      type: "number",
      default: "1.6",
    },
    color: {
      description: "Text color as CSS value (e.g. '#333', 'red').",
      type: "string",
      default: "#000",
    },
    highlight: {
      description: "Background highlight color. Null for no highlight.",
      type: "string | null",
    },
    textAlign: {
      description: "Text alignment.",
      type: "string",
      default: "left",
      options: ["left", "center", "right", "justify"],
    },
  },

  image: {
    src: {
      description: "Image URL, uploaded asset, or `ref:self/p0/<element>` for a file a participant uploaded earlier.",
      type: "string",
      required: true,
      stimulus: true,
    },
    alt: {
      description: "Alternative text for accessibility.",
      type: "string",
      stimulus: true,
    },
    width: {
      description: "CSS width (e.g. '300px', '100%').",
      type: "string",
    },
    height: {
      description: "CSS height (e.g. '200px', 'auto').",
      type: "string",
    },
    objectFit: {
      description: "How the image fits its container.",
      type: "string",
      default: "contain",
      options: ["contain", "cover", "fill", "none", "scale-down"],
    },
  },

  video: {
    src: {
      description: "Video URL, uploaded asset, or `ref:self/p0/<element>` for a recording made at an earlier step.",
      type: "string",
      required: true,
      stimulus: true,
    },
    autoplay: {
      description: "Start playing automatically when shown.",
      type: "boolean",
      default: "false",
    },
    loop: {
      description: "Restart the video when it ends.",
      type: "boolean",
      default: "false",
    },
    controls: {
      description: "Show playback controls (play, pause, seek).",
      type: "boolean",
      default: "true",
    },
    muted: {
      description: "Mute audio. Required for autoplay in most browsers.",
      type: "boolean",
      default: "false",
    },
  },

  audio: {
    src: {
      description: "Audio URL, uploaded asset, or `ref:self/p0/<element>` for a recording made at an earlier step.",
      type: "string",
      required: true,
      stimulus: true,
    },
    autoplay: {
      description: "Start playing automatically when shown.",
      type: "boolean",
      default: "false",
    },
    loop: {
      description: "Restart the audio when it ends.",
      type: "boolean",
      default: "false",
    },
    controls: {
      description: "Show playback controls.",
      type: "boolean",
      default: "true",
    },
  },

  button: {
    label: {
      description: "Text displayed on the button.",
      type: "string",
      default: "Continue",
      stimulus: true,
    },
    style: {
      description: "Visual style of the button.",
      type: "string",
      default: "primary",
      options: ["primary", "secondary", "danger"],
    },
    disabled: {
      description: "Whether the button starts disabled.",
      type: "boolean",
      default: "false",
    },
    value: {
      description: "Value recorded in data when clicked. Null means no data event.",
      type: "string | null",
    },
    holdDuration: {
      description: "Milliseconds the button must be held to activate (0 = instant click).",
      type: "number",
      default: "0",
    },
    enableTime: {
      description: "Milliseconds to wait before enabling the button. Null = enabled immediately.",
      type: "number | null",
    },
    enableElement: {
      description: "Element names to enable when this button is clicked.",
      type: "string[]",
    },
    interactableTimes: {
      description: "Max number of times the button can be clicked. 0 = unlimited.",
      type: "number",
      default: "0",
    },
    size: {
      description: "Button size.",
      type: "string",
      default: "medium",
      options: ["small", "medium", "large"],
    },
    align: {
      description: "Horizontal position of the button within its cell.",
      type: "string",
      default: "center",
      options: ["left", "center", "right"],
    },
  },

  recorder: {
    mode: {
      description: "What to record.",
      type: "string",
      default: "video",
      options: ["audio", "video", "screen"],
    },
    maxDuration: {
      description: "Maximum recording duration in seconds. Null = no limit.",
      type: "number | null",
    },
    autoStart: {
      description: "Begin recording automatically when the element appears.",
      type: "boolean",
      default: "false",
    },
    showPreview: {
      description: "Show a live preview of the camera/screen feed.",
      type: "boolean",
      default: "true",
    },
    showStopButton: {
      description: "Show a stop button for the participant to end recording.",
      type: "boolean",
      default: "true",
    },
    constraints: {
      description: "MediaStream constraints object (advanced). E.g. {video: {width: 640}}.",
      type: "object",
    },
    uploadMode: {
      description: "When to upload the recording.",
      type: "string",
      default: "on-stop",
      options: ["on-stop", "streaming"],
    },
  },

  "input-textfield": {
    placeholder: {
      description: "Placeholder text shown when the field is empty.",
      type: "string",
      stimulus: true,
    },
    multiline: {
      description: "Allow multiple lines of text (textarea instead of input).",
      type: "boolean",
      default: "false",
    },
    maxLength: {
      description: "Maximum number of characters. Null = no limit.",
      type: "number | null",
    },
    required: {
      description: "Participant must enter a value before proceeding.",
      type: "boolean",
      default: "false",
    },
    validation: {
      description: "Regex pattern for input validation. Null = no validation.",
      type: "string | null",
    },
    defaultValue: {
      description:
        "Text the field starts with, or a reference to an earlier answer (ref:self/p2/name). A pre-filled value is recorded as the answer (on the desktop screen) unless the participant changes it.",
      type: "string",
    },
  },

  "input-select": {
    options: {
      description:
        'Dropdown options as an array of {value, label} objects. E.g. [{"value":"a","label":"Option A"}].',
      type: "{ value: string; label: string }[]",
      required: true,
      stimulus: true,
    },
    multiple: {
      description: "Allow selecting multiple options.",
      type: "boolean",
      default: "false",
    },
    required: {
      description: "Participant must select a value before proceeding.",
      type: "boolean",
      default: "false",
    },
    defaultValue: {
      description:
        "Option value selected at start, or a reference to an earlier answer. A value that matches no option is ignored; a pre-filled value is recorded as the answer (on the desktop screen).",
      type: "string",
    },
  },

  "input-slider": {
    min: {
      description: "Minimum slider value.",
      type: "number",
      default: "0",
      stimulus: true,
    },
    max: {
      description: "Maximum slider value.",
      type: "number",
      default: "100",
      stimulus: true,
    },
    step: {
      description: "Step increment between values.",
      type: "number",
      default: "1",
    },
    defaultValue: {
      description: "Initial position, or a reference to an earlier numeric answer. A value that is not a number falls back to 50; a set value is recorded as the answer (on the desktop screen).",
      type: "number | string",
      default: "50",
    },
    leftLabel: {
      description: "Label displayed at the left end of the slider.",
      type: "string",
      stimulus: true,
    },
    rightLabel: {
      description: "Label displayed at the right end of the slider.",
      type: "string",
      stimulus: true,
    },
    showValue: {
      description: "Display the current numeric value above the slider.",
      type: "boolean",
      default: "true",
    },
  },

  timer: {
    duration: {
      description: "Countdown duration in seconds.",
      type: "number",
      default: "60",
      stimulus: true,
    },
    visible: {
      description: "Whether the timer is visible to the participant.",
      type: "boolean",
      default: "true",
    },
    format: {
      description: "How the remaining time is displayed.",
      type: "string",
      default: "mm:ss",
      options: ["mm:ss", "seconds", "progress-bar"],
    },
    warningTime: {
      description: "Seconds remaining when the timer turns red as a warning.",
      type: "number",
    },
  },

  "body-detector": {
    gesture: {
      description: "The gesture or pose to detect.",
      type: "string",
      required: true,
      options: [
        "face-present",
        "face-absent",
        "hands-raised",
        "hand-raised-left",
        "hand-raised-right",
        "index-finger-up",
        "thumbs-up",
        "open-palm",
        "peace-sign",
        "fist",
      ],
    },
    duration: {
      description: "Milliseconds the gesture must be held to trigger.",
      type: "number",
      default: "1000",
    },
    confidenceThreshold: {
      description: "Detection confidence threshold (0–1). Higher = stricter.",
      type: "number",
      default: "0.7",
    },
    showOverlay: {
      description: "Show a visual overlay with skeleton/landmark indicators.",
      type: "boolean",
      default: "true",
    },
  },

  "volume-check": {
    threshold: {
      description: "Audio volume level (0–1) that triggers the action.",
      type: "number",
      default: "0.1",
    },
    action: {
      description: "What happens when volume exceeds the threshold.",
      type: "string",
      default: "alert",
      options: ["alert", "proceed"],
    },
    message: {
      description: "Message shown when the volume check is triggered.",
      type: "string",
    },
  },

  "speech-recognizer": {
    language: {
      description: "BCP-47 language code for recognition (e.g. 'en-US', 'ja-JP').",
      type: "string",
      default: "en-US",
    },
    keywords: {
      description: "Specific words/phrases to listen for. E.g. [\"yes\", \"no\"].",
      type: "string[]",
    },
    action: {
      description: "Event triggered when a keyword is recognized.",
      type: "string",
      default: "data",
      options: ["data", "proceed", "alert"],
    },
    continuous: {
      description: "Keep listening after each recognition result.",
      type: "boolean",
      default: "false",
    },
  },

  "multi-capture": {
    sources: {
      description: "Array of device sources to capture from",
      type: "DeviceSource[]",
      required: true,
    },
    includeDesktop: {
      description: "Whether to include the desktop webcam as a source",
      type: "boolean",
      default: "false",
    },
    desktopMode: {
      description: "Capture mode for the desktop source",
      type: "string",
      options: ["video", "audio"],
      default: "video",
    },
    maxDevices: {
      description: "Maximum number of connected devices",
      type: "number",
    },
    maxDuration: {
      description: "Maximum recording duration in seconds (null = unlimited)",
      type: "number | null",
    },
    autoStart: {
      description: "Automatically start recording when all sources connect",
      type: "boolean",
      default: "false",
    },
    pairOnly: {
      description: "Pair the devices and show their video, but do not record. Use it on a step before the recording steps; a paired phone stays paired.",
      type: "boolean",
      default: "false",
    },
    showPairing: {
      description: "Show the QR code while a device is missing. Set it to false on recording steps after a pairOnly step; a paired phone stays paired.",
      type: "boolean",
      default: "true",
    },
    showStopButton: {
      description: "Show the Stop Recording button while recording. A proceed (for example a Next button) also stops the recording.",
      type: "boolean",
      default: "the value of showPreview",
    },
    uploadMode: {
      description: "How recordings are uploaded after capture",
      type: "string",
      options: ["on-stop", "streaming"],
      default: "on-stop",
    },
    showPreview: {
      description: "Show live preview of captured streams",
      type: "boolean",
      default: "true",
    },
  },
  "video-chat": {
    participant: {
      description:
        "Who the tile shows: self, partner (the first other member of your group), partner:k (the k-th, by seat) or seat:n (the session member at seat n, counting from 1). Resolved per step; checked in the Progress tab.",
      type: "string",
      default: "partner",
    },
    channels: {
      description:
        "What the tile exchanges: video, audio and/or text. On a self tile video/audio are what you publish; on another participant's tile they are what is rendered. A tile without video or audio asks for no camera or microphone.",
      type: "string[]",
      default: "[\"video\", \"audio\"]",
    },
    mirror: {
      description: "Flip the video horizontally.",
      type: "boolean",
      default: "true for self, false otherwise",
    },
    label: {
      description: "Caption shown over the tile. Empty hides it.",
      type: "string",
    },
    record: {
      description:
        "Record the tile's video/audio channels as an upload under this element's name (referenceable later as ref:self/p<N>/<name>). Ignored on a text-only tile; a tile that records and has text stores its transcript under <name>__transcript.",
      type: "boolean",
      default: "false",
    },
  },

  keyboard: {
    keys: {
      description:
        "Keys that count as a response, using KeyboardEvent.key values (e.g. [\"f\", \"j\", \" \"]). Empty accepts any key.",
      type: "string[]",
      default: "[] (any key)",
      stimulus: true,
    },
    recordMode: {
      description:
        "'first' records only the first accepted keypress; 'all' records every keypress in order.",
      type: "string",
      default: "first",
      options: ["first", "all"],
    },
    caseSensitive: {
      description: "Match the keys list case-sensitively.",
      type: "boolean",
      default: "false",
    },
    preventDefault: {
      description:
        "Suppress the browser's default action for accepted keys (e.g. page scrolling on space).",
      type: "boolean",
      default: "false",
    },
    hint: {
      description:
        "Optional on-screen prompt. The element renders nothing when omitted, so it can listen invisibly.",
      type: "string",
    },
  },

  "input-option-group": {
    options: {
      description: "Choices to present, as { value, label } objects.",
      type: "{ value: string; label: string }[]",
      required: true,
      stimulus: true,
    },
    optionType: {
      description:
        "Control style. 'radio' and 'toggle' record a single value; 'checkbox' records an array.",
      type: "string",
      default: "radio",
      options: ["radio", "checkbox", "toggle"],
    },
    inline: {
      description: "Lay the options out horizontally instead of stacked.",
      type: "boolean",
      default: "false",
    },
    defaultValue: {
      description:
        "Pre-selected value — a string for radio/toggle, an array for checkbox — or a reference to an earlier answer. Values that match no option are ignored; a pre-selected value is recorded as the answer (on the desktop screen).",
      type: "string | string[] | null",
    },
    required: {
      description: "Mark the group as requiring an answer.",
      type: "boolean",
      default: "false",
    },
  },

  "input-file-picker": {
    accept: {
      description:
        "Comma-separated list of accepted file types, passed to the file input (e.g. 'image/*,.pdf').",
      type: "string",
      default: "any",
    },
    multiple: {
      description: "Allow selecting more than one file.",
      type: "boolean",
      default: "false",
    },
    maxSizeMb: {
      description: "Reject any file larger than this, in megabytes.",
      type: "number",
      default: "100",
    },
    maxFiles: {
      description: "Maximum number of files accepted in total.",
      type: "number",
      default: "1, or unlimited when multiple is true",
    },
    label: {
      description: "Text shown on the picker button.",
      type: "string",
      default: "Choose file",
    },
  },

  survey: {
    surveyJson: {
      description:
        "SurveyJS survey definition. Answers are recorded under their own question names and grouped under the element name.",
      type: "object | null",
      required: true,
    },
    submitLabel: {
      description: "Text on the survey's submit button.",
      type: "string",
      default: "Complete",
    },
    showProgressBar: {
      description: "Where to show the multi-page progress bar.",
      type: "string",
      default: "off",
      options: ["off", "top", "bottom"],
    },
    proceedOnComplete: {
      description:
        "Advance to the next progress as soon as the survey is submitted. Leave false to combine the survey with other elements behind a shared submit button.",
      type: "boolean",
      default: "false",
    },
  },

  "facial-expression-detector": {
    mode: {
      description:
        "'trigger' fires events when an expression is held; 'log' records a timeline of raw blendshape scores for offline analysis.",
      type: "string",
      default: "trigger",
      options: ["trigger", "log"],
    },
    expression: {
      description: "Expression to watch for in trigger mode.",
      type: "string",
      default: "smile",
      options: ["smile", "frown", "brow-raise", "mouth-open", "eyes-closed", "surprise"],
    },
    threshold: {
      description: "Score from 0–1 the expression must reach to count as present.",
      type: "number",
      default: "0.5",
    },
    duration: {
      description:
        "Milliseconds the expression must be held before events fire. 0 fires on the first frame above threshold.",
      type: "number",
      default: "500",
    },
    showOverlay: {
      description:
        "Show the webcam preview and a live score meter. The element runs invisibly when false.",
      type: "boolean",
      default: "false",
    },
    sampleRate: {
      description: "Samples recorded per second in log mode.",
      type: "number",
      default: "10",
    },
    blendshapes: {
      description:
        "Blendshape names to record in log mode (e.g. [\"mouthSmileLeft\", \"jawOpen\"]). Empty records all 52.",
      type: "string[]",
      default: "[] (all 52)",
    },
  },
};

export function getParamHelp(
  elementType: ElementType,
): ElementParamHelp | null {
  return parameterHelp[elementType] ?? null;
}

export function getParamInfo(
  elementType: ElementType,
  paramName: string,
): ParamInfo | null {
  return parameterHelp[elementType]?.[paramName] ?? null;
}

/** The params of `elementType` that carry a stimulus, in declaration order. */
export function stimulusParams(elementType: ElementType): string[] {
  return Object.entries(parameterHelp[elementType] ?? {})
    .filter(([, info]) => info.stimulus)
    .map(([name]) => name);
}
