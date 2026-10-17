import type { ElementSurface } from "./surfaces.js";
export type { ElementSurface } from "./surfaces.js";
import type { ClientErrorReport } from "./errors.js";

// ── Enums ──────────────────────────────────────────────

export type DeviceMode = "NONE" | "CAMERA" | "CONTROLLER";
export type MatchingStrategy = "FIFO" | "PROPERTY" | "MANUAL";
export type SessionStatus = "WAITING" | "ACTIVE" | "CLOSED";
export type UploadStatus = "UPLOADING" | "COMPLETE" | "FAILED" | "SAVED_LOCALLY";

export type RoutineType =
  | "routine-borderless"
  | "routine-card"
  | "routine-consent"
  | "routine-end"
  | "routine-end-matching"
  | "routine-matching"
  | "routine-pos-check"
  | "routine-video-chat"
  | "routine-survey";

export type ElementType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "button"
  | "recorder"
  | "multi-capture"
  | "input-textfield"
  | "input-select"
  | "input-slider"
  | "timer"
  | "body-detector"
  | "volume-check"
  | "speech-recognizer"
  | "video-chat"
  | "keyboard"
  | "input-option-group"
  | "input-file-picker"
  | "survey"
  | "facial-expression-detector";

export type EventType = "data" | "proceed" | "complete" | "alert";
export type EventTrigger = "click" | "press" | "change" | "timeout" | "detection" | "keyword";
export type DisappearMode = "visibility" | "removed";

export type RunnerState =
  | "INIT"
  | "LOBBY"
  | "RUNNING"
  | "MATCHING"
  | "COMPLETED"
  | "WITHDRAWN";

// ── Element Params ─────────────────────────────────────

export type TextAlign = "left" | "center" | "right" | "justify";
export type FontStyle = "normal" | "italic";

export interface TextParams {
  content: string;
  /** CSS font-family. Presets live in `ame-shared/textStyle`; any string is accepted. */
  fontFamily?: string;
  /** CSS font-size, e.g. "16px". The builder edits px; other units are left untouched. */
  fontSize?: string;
  /** CSS font-weight: "normal", "500", "600" or "bold". */
  fontWeight?: string;
  fontStyle?: FontStyle;
  /** Unitless line-height multiplier. */
  lineHeight?: number;
  color?: string;
  highlight?: string | null;
  textAlign?: TextAlign;
}

export interface ImageParams {
  src: string;
  alt?: string;
  width?: string;
  height?: string;
  objectFit?: string;
}

export interface VideoParams {
  src: string;
  autoplay?: boolean;
  loop?: boolean;
  controls?: boolean;
  muted?: boolean;
}

export interface AudioParams {
  src: string;
  autoplay?: boolean;
  loop?: boolean;
  controls?: boolean;
}

export type ButtonSize = "small" | "medium" | "large";
export type ButtonAlign = "left" | "center" | "right";

export interface ButtonParams {
  label?: string;
  style?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  value?: string | null;
  holdDuration?: number;
  enableTime?: number | null;
  enableElement?: string[];
  interactableTimes?: number;
  /** Default "medium" — today's padding and 14px. */
  size?: ButtonSize;
  /** Default "center" — today's justify-content. */
  align?: ButtonAlign;
}

export interface RecorderParams {
  mode?: "audio" | "video" | "screen";
  maxDuration?: number | null;
  autoStart?: boolean;
  showPreview?: boolean;
  showStopButton?: boolean;
  constraints?: Record<string, unknown>;
  uploadMode?: "on-stop" | "streaming";
}

export interface DeviceSource {
  label: string;
  capabilities: ("camera" | "microphone")[];
  facingMode?: "user" | "environment";
  constraints?: Record<string, unknown>;
}

export interface MultiCaptureParams {
  sources: DeviceSource[];
  includeDesktop?: boolean;
  desktopMode?: "video" | "audio";
  maxDevices?: number;
  maxDuration?: number | null;
  autoStart?: boolean;
  uploadMode?: "on-stop" | "streaming";
  showPreview?: boolean;
  /** Pair the devices and show their video, but never record: a step before the recording steps. */
  pairOnly?: boolean;
  /** `false`: never show the QR code on this step; pair on an earlier `pairOnly` step. Default true. */
  showPairing?: boolean;
  /** Show the Stop Recording button while recording. Default: the value of `showPreview`. */
  showStopButton?: boolean;
}

export interface InputTextfieldParams {
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number | null;
  required?: boolean;
  validation?: string | null;
  /** Starting text; may be a whole-value ref to an earlier answer. */
  defaultValue?: string;
}

export interface InputSelectParams {
  options: { value: string; label: string }[];
  multiple?: boolean;
  required?: boolean;
  /** Option value selected at start; may be a whole-value ref. A value matching no option is ignored. */
  defaultValue?: string;
}

export interface InputSliderParams {
  min?: number;
  max?: number;
  step?: number;
  /** Starting position; may be a whole-value ref to an earlier numeric answer. */
  defaultValue?: number | string;
  leftLabel?: string;
  rightLabel?: string;
  showValue?: boolean;
}

export interface TimerParams {
  duration: number;
  visible?: boolean;
  format?: "mm:ss" | "seconds" | "progress-bar";
  warningTime?: number;
}

export type GestureTrigger =
  | "face-present"
  | "face-absent"
  | "hands-raised"
  | "hand-raised-left"
  | "hand-raised-right"
  | "index-finger-up"
  | "thumbs-up"
  | "open-palm"
  | "peace-sign"
  | "fist";

export interface BodyDetectorParams {
  gesture: GestureTrigger;
  duration?: number;
  confidenceThreshold?: number;
  showOverlay?: boolean;
}

export interface VolumeCheckParams {
  threshold?: number;
  action?: "alert" | "proceed";
  message?: string;
}

export interface SpeechRecognizerParams {
  language?: string;
  keywords?: string[];
  action?: "data" | "proceed" | "alert";
  continuous?: boolean;
}

export interface KeyboardParams {
  /** Keys that count as a response. Empty array accepts any key. */
  keys?: string[];
  /** "first" records only the first accepted keypress; "all" records every one. */
  recordMode?: "first" | "all";
  caseSensitive?: boolean;
  /** Suppress the browser default action (scrolling on space, etc.). */
  preventDefault?: boolean;
  /** Optional on-screen prompt. Element is invisible when omitted. */
  hint?: string;
}

export interface InputOptionGroupParams {
  options: { value: string; label: string }[];
  optionType?: "radio" | "checkbox" | "toggle";
  inline?: boolean;
  /** String for radio/toggle, array for checkbox. */
  defaultValue?: string | string[] | null;
  required?: boolean;
}

export interface InputFilePickerParams {
  /** Comma-separated accept list passed to the file input (e.g. "image/*,.pdf"). */
  accept?: string;
  multiple?: boolean;
  maxSizeMb?: number;
  maxFiles?: number;
  label?: string;
}

export interface SurveyParams {
  surveyJson: Record<string, unknown> | null;
  submitLabel?: string;
  showProgressBar?: "off" | "top" | "bottom";
  /** Advance to the next progress as soon as the survey is submitted. */
  proceedOnComplete?: boolean;
}

export type FacialExpression =
  | "smile"
  | "frown"
  | "brow-raise"
  | "mouth-open"
  | "eyes-closed"
  | "surprise";

export interface FacialExpressionDetectorParams {
  /** "trigger" fires events on a held expression; "log" records a score timeline. */
  mode?: "trigger" | "log";
  // mode: "trigger"
  expression?: FacialExpression;
  threshold?: number;
  /** Milliseconds the expression must be held before events fire. */
  duration?: number;
  showOverlay?: boolean;
  // mode: "log"
  /** Samples per second recorded in log mode. */
  sampleRate?: number;
  /** Blendshape names to record. Empty array records all 52. */
  blendshapes?: string[];
}

/** What a video-chat tile exchanges with its participant (spec §6.1). */
export type ChatChannel = "video" | "audio" | "text";

export interface VideoChatParams {
  /** `self`, `partner`, `partner:<k>` or `seat:<n>`; absent or blank means `partner`. */
  participant?: string;
  /** Absent means `["video", "audio"]`; an explicit `[]` means the tile exchanges nothing. */
  channels?: ChatChannel[];
  /** Absent means true for a self tile and false otherwise. */
  mirror?: boolean;
  /** Caption over the tile; absent or `""` hides it. */
  label?: string;
  /** Record this tile's media channels as an Upload under the element name. */
  record?: boolean;
}

/** One seat of a matched session. `seat` is 0-based; `slotName` is the matching slot's name. */
export interface SessionMember {
  participantId: string;
  seat: number;
  slotName: string | null;
}

/** One text-channel message as the server stamped it. `at` is epoch milliseconds. */
export interface ChatLine {
  from: string;
  seat: number;
  text: string;
  at: number;
}

export type ElementParams =
  | TextParams
  | ImageParams
  | VideoParams
  | AudioParams
  | ButtonParams
  | RecorderParams
  | MultiCaptureParams
  | InputTextfieldParams
  | InputSelectParams
  | InputSliderParams
  | TimerParams
  | BodyDetectorParams
  | VolumeCheckParams
  | SpeechRecognizerParams
  | KeyboardParams
  | InputOptionGroupParams
  | InputFilePickerParams
  | SurveyParams
  | FacialExpressionDetectorParams
  | VideoChatParams
  | Record<string, never>;

// ── Element Event ──────────────────────────────────────

export interface ElementEvent {
  type: EventType;
  trigger: EventTrigger;
  params?: {
    key?: string;
    message?: string;
    delay?: number;
    holdDuration?: number;
    /**
     * How many answers a `data` event accepts from one participant.
     *
     * `true` accumulates: every firing appends, and the response is an array in
     * the order the answers were given. `false` locks: the first answer stands
     * and later firings record nothing. Absent leaves the original behaviour —
     * each firing replaces the last — which is what `change` triggers on
     * inputs, sliders and surveys need in order to let an answer be revised.
     */
    multiple?: boolean;
  };
}

// ── Grid Layout ───────────────────────────────────────

export interface GridColumn {
  span: number;
}

export interface GridRow {
  columns: GridColumn[];
  justify?: "start" | "center" | "end" | "between" | "around";
}

/**
 * How elements align across their cell's width.
 *
 * Deliberately NOT a field on RoutineLayout: it is a fact about a routine
 * *type* (a borderless routine centres its elements because no card gives them
 * a width), not something a researcher authors. See defaultCellAlign in
 * shared/src/layout/defaults.ts.
 */
export type CellAlign = "start" | "center" | "end" | "stretch";

/** A locked stage's aspect ratio. "device" is a 9:19.5 handset viewport. */
export type StageRatio = "16:9" | "4:3" | "device";

/** How a surface is authored: flexbox rows, or absolute placement. */
export type LayoutMode = "flow" | "free";

/**
 * Absolute placement, in percent of the stage.
 *
 * No z: overlap is forbidden in v1, so stacking order never arises. Height is
 * explicit rather than auto because collision cannot be verified against a box
 * whose height is unknown until it renders.
 */
export interface FreePlacement {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

export interface RoutineLayout {
  rows: GridRow[];
  gap?: string;
  padding?: string;
  alignItems?: "start" | "center" | "end" | "stretch";
  justifyContent?: "start" | "center" | "end" | "between" | "around";
  /** Absent means "flow" — every layout authored before this field. */
  mode?: LayoutMode;
  /** Absent means "fluid": the routine fills the participant's window. */
  stage?: "fluid" | StageRatio;
}

// ── Element Position ───────────────────────────────────

export interface ElementPosition {
  row: number;
  column: number;
  order?: number;
}

// ── Element ────────────────────────────────────────────

export interface ElementConfig {
  name: string;
  type: ElementType;
  params: ElementParams;
  showForRoles?: string[];
  showForSeats?: number[];
  showWhen?: PropertyFilter[];
  setsProperty?: string;
  onsetTime?: number;
  duration?: number | null;
  disappearMode?: DisappearMode;
  /**
   * Which of the participant's screens this element is on. Absent means the
   * desktop. Composes with showForRoles: ["Director"] + "device" is the
   * Director's phone, and the server's role filter runs unchanged.
   */
  surface?: ElementSurface;
  position?: ElementPosition;
  /**
   * Where it sits when its surface is in free mode. Kept alongside `position`
   * rather than replacing it, so switching flow <-> free is lossless and
   * reversible: flip to free, drag, flip back, and the rows are as they were.
   */
  placement?: FreePlacement;
  /**
   * Whether the free-mode box keeps the natural aspect ratio of the media
   * inside it. Absent is not "false": it means the default for the type —
   * locked for image and video, free for everything else — so routines
   * authored before this field behave as they read. See `aspectLocked`.
   */
  lockAspect?: boolean;
  events?: ElementEvent[];
}

// ── Property System ───────────────────────────────────

export type PropertyFilterOperator = "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "in";

export interface PropertyFilter {
  property: string;
  operator: PropertyFilterOperator;
  value: unknown;
}

export interface MatchingSlot {
  name: string;
  filters?: PropertyFilter[];
}

// ── Matching Config ────────────────────────────────────

/**
 * How role indices are dealt across a matched cohort.
 *
 * There is deliberately no "arrival" mode. Arrival order and a random draw are
 * both unsystematic, but arrival order is not guaranteed independent of
 * participant characteristics — whoever reaches the waiting room first is
 * disproportionately the faster reader or the better connection. It is never a
 * better choice than random, so it is not offered.
 */
export type RoleAssignment =
  | { mode: "random" }
  | {
      mode: "counterbalanced";
      /** `rotation` = n cyclic shifts (a Latin square). `permutation` = all n!. */
      set: "rotation" | "permutation";
      /** `sequential` = a predictable cycle. `block-shuffled` = shuffled per block. */
      order: "sequential" | "block-shuffled";
    };

export interface MatchingConfig {
  strategy: "fifo" | "property" | "manual";
  slots: MatchingSlot[];
  timeout?: number;
  timeoutAction?: "proceed" | "wait";
  /** Absent means `{ mode: "random" }`. */
  assignment?: RoleAssignment;
}

// ── Device Config ──────────────────────────────────────

/**
 * One WebRTC message between a participant's desktop and one of their
 * phones: a description (`sdp`) or an ICE `candidate`. It never uses the
 * `signal:*` events, which carry the participant-to-participant call.
 */
export type DeviceSignal =
  | { sdp: RTCSessionDescriptionInit; candidate?: never }
  | { candidate: RTCIceCandidateInit; sdp?: never };

export interface DeviceConfig {
  mode: "camera" | "controller" | null;
  required?: boolean;
  cameraFacing?: "user" | "environment";
}

// ── Routine Config ─────────────────────────────────────

export type NextButtonMode = "visible" | "hidden" | "disabled";

export interface RoutineCardConfig {
  width?: string;
  padding?: string;
  nextButtonMode?: NextButtonMode;
  collectData?: boolean;
  nextLabel?: string;
}

export interface RoutineConsentConfig {
  agreeLabel?: string;
  disagreeLabel?: string;
  withdrawOnDisagree?: boolean;
}

/**
 * How the experiment ends.
 * - "debrief": show the message and a Finish button (default)
 * - "debrief-redirect": show the message, then redirect on confirmation
 * - "redirect-only": redirect on arrival without showing a debrief
 */
export type FinishMode = "debrief" | "debrief-redirect" | "redirect-only";

export interface RoutineEndConfig {
  message?: string;
  redirectUrl?: string | null;
  finishMode?: FinishMode;
  autoCompleteDelay?: number;
}

/**
 * Resolve the effective finish mode, inferring it for end routines authored
 * before finishMode existed.
 */
export function resolveFinishMode(config: RoutineEndConfig | undefined): FinishMode {
  if (config?.finishMode) return config.finishMode;
  return config?.redirectUrl ? "debrief-redirect" : "debrief";
}

export type FovMode = "preset" | "custom" | "distance" | "legacy";
export type FovPreset = "face" | "upper-body" | "full-body";

export interface RoutinePosCheckConfig {
  mode: FovMode;
  preset?: FovPreset;
  targetLandmarks?: number[];
  faceRatioMin?: number;
  faceRatioMax?: number;
  confidenceThreshold?: number;
  requiredDuration?: number;
}

/**
 * How a video-chat routine shows the call. `auto` draws its own video panel
 * beside the elements; `custom` shows only the video-chat elements the
 * researcher placed in the layout. Read it through `resolveVideoLayout`.
 */
export type VideoLayout = "auto" | "custom";

export interface RoutineVideoChatConfig {
  /** Absent means `auto`, the layout every routine had before this field. */
  videoLayout?: VideoLayout;
  /** `auto` only. The title row of the task card; `{role}` becomes the participant's role. Empty hides the row. */
  cardTitle?: string;
  /** `auto` only. */
  showLocalVideo?: boolean;
  /** `auto` only. Record the participant's own camera and microphone; uploads under the element name `local-video`. */
  recordLocal?: boolean;
  /** `auto` only. */
  elementPosition?: "left" | "top" | "bottom";
  /** Shown in place of the partner tile when this participant is left solo. */
  partnerUnavailableText?: string;
}

export interface RoutineSurveyConfig {
  surveyJson: Record<string, unknown> | null;
  submitLabel?: string;
  showProgressBar?: "off" | "top" | "bottom";
  width?: string;
}

export type RoutineSpecificConfig =
  | RoutineCardConfig
  | RoutineConsentConfig
  | RoutineEndConfig
  | RoutinePosCheckConfig
  | RoutineVideoChatConfig
  | RoutineSurveyConfig
  | Record<string, never>;

// ── Routine ────────────────────────────────────────────

export interface RoutineConfig {
  name: string;
  type: RoutineType;
  layout: RoutineLayout;
  roles?: string[];
  elements: ElementConfig[];
  matching?: MatchingConfig | null;
  device?: DeviceConfig | null;
  config?: RoutineSpecificConfig;
  interactionPattern?: InteractionPattern;
}

// ── Interaction Pattern ───────────────────────────────

export type InteractionPattern =
  | { type: "all" }
  | { type: "fixed"; groups: number[][] }
  | { type: "round-robin"; groupSize: number }
  | { type: "sequence"; steps: number[][][] };

// ── Randomization ─────────────────────────────────────

export type RandomizationMethod = "shuffle" | "latin-square" | "block";

export interface RandomizationRange {
  fromTrial: number;
  toTrial: number;
  method: RandomizationMethod;
  blockSize?: number;
}

/** Keyed by condition name (use "Basic" when no conditions defined) */
export type RandomizationConfig = Record<string, RandomizationRange[]>;

export interface MatchingPeriod {
  fromProgress: number;
  toProgress: number;
}

// ── Experiment ─────────────────────────────────────────

export interface ExperimentCreate {
  name: string;
  description?: string;
  visible?: boolean;
  allowNew?: boolean;
  img?: string | null;
  avCollection?: boolean;
  bodyDetection?: boolean;
  videoChat?: boolean;
  supplementaryDevice?: DeviceMode;
  activeTime?: number;
  rollBackTime?: number;
  participantsPerSession?: number;
  conditions?: string[];
  randomization?: boolean;
  randomizationConfig?: RandomizationConfig;
  matchingStrategy?: MatchingStrategy;
  initialProperties?: Record<string, unknown>;
  conditionProperties?: Record<string, Record<string, unknown>>;
  routines: RoutineConfig[];
}

export interface ExperimentSummary {
  id: string;
  name: string;
  description: string;
  visible: boolean;
  videoChat: boolean;
  conditions: string[];
  participantsPerSession: number;
  createdAt: string;
  updatedAt: string;
  _count?: {
    participants: number;
    results: number;
  };
}

// ── Participant ────────────────────────────────────────

export interface ParticipantInfo {
  id: string;
  experimentId: string;
  responseId: string;
  condition: string | null;
  progress: number;
  currentStage: number;
  isLoggedIn: boolean;
  consent: boolean;
  completion: boolean;
  withdraw: boolean;
  role: number;
  lastLogTime: string | null;
  createdAt: string;
}

// ── Socket.IO Events ───────────────────────────────────

// Client → Server
/** STUN and, when the server has TURN, a TURN password that expires at `expiresAt` (epoch ms). */
export interface IceServerList {
  iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
  expiresAt: number | null;
}

export interface ClientToServerEvents {
  "exp:init": (payload: { experimentId: string; platform: string }) => void;
  "exp:join": (payload: { responseId?: string; externalId?: string }) => void;
  "exp:ready": () => void;
  "exp:proceed": () => void;
  "exp:data": (payload: DataPayload) => void;
  "exp:upload:done": (payload: { uploadId: string }) => void;
  "exp:consent": () => void;
  "exp:withdraw": () => void;
  "exp:complete": () => void;
  "match:join": (payload: { routineName: string }) => void;
  /** Post a text-channel message to this participant's current group. */
  "chat:send": (payload: { text: string }) => void;
  /** Ask for the current group's buffered thread (answered with `chat:history`). */
  "chat:history": () => void;
  /** A failure in the participant's browser. Rate-limited per socket; never pauses the experiment. */
  "client:error": (payload: ClientErrorReport) => void;
  "signal:offer": (payload: { targetPeerId: string; sdp: RTCSessionDescriptionInit }) => void;
  "signal:answer": (payload: { targetPeerId: string; sdp: RTCSessionDescriptionInit }) => void;
  "signal:ice": (payload: { targetPeerId: string; candidate: RTCIceCandidateInit }) => void;
  "device:connect": (payload: { participantId: string; mode: "camera" | "controller"; element?: string }) => void;
  /** The phone sends it to its own desktop; the desktop names the phone by `deviceId` (its socket id). */
  "device:signal": (payload: DeviceSignal & { deviceId?: string }) => void;
  /** A new TURN password before the old one expires; answered only for a joined participant or a paired device. */
  "ice:refresh": () => void;
  /**
   * A control on the phone was used. The phone sends the intent only — the
   * desktop runner owns the state machine and applies it. `progress` is the
   * routine the phone believed it was on, so a press from a routine the
   * participant has left can be dropped.
   */
  "device:input": (payload: {
    elementName: string;
    trigger: EventTrigger;
    value: unknown;
    progress: number;
  }) => void;
  "device:slots-init": (payload: { elementName: string; sources: DeviceSource[] }) => void;
  "device:slot-claim": (payload: { slotLabel: string; elementName: string }) => void;
  "monitor:subscribe": (payload: { participantId: string }) => void;
  "monitor:text-instruction": (payload: { participantId: string; target: string; message: string }) => void;
  "monitor:join-chat": (payload: { participantId: string }) => void;
  "monitor:signal:offer": (payload: { participantId: string; sdp: RTCSessionDescriptionInit }) => void;
  "monitor:signal:answer": (payload: { participantId: string; sdp: RTCSessionDescriptionInit }) => void;
  "monitor:signal:ice": (payload: { participantId: string; candidate: RTCIceCandidateInit }) => void;
  "upload:start": (payload: {
    experimentId: string;
    participantId: string;
    progress: number;
    trial: number;
    elementName: string;
    timestamp: string;
    mimeType: string;
  }) => void;
  "upload:chunk": (payload: {
    uploadId: string;
    chunkIndex: number;
    data: ArrayBuffer;
  }) => void;
  "upload:finish": (payload: { uploadId: string }) => void;
  "upload:resume": (payload: { uploadId: string }) => void;
}

// Server → Client
export interface ServerToClientEvents {
  "exp:config": (payload: ExperimentConfigPayload) => void;
  /** Sent after `exp:joined` and after `device:connect`, and on `ice:refresh`. */
  "ice:servers": (payload: IceServerList) => void;
  "exp:joined": (payload: JoinedPayload) => void;
  "exp:content": (payload: ContentPayload) => void;
  /**
   * The elements for this participant's phone, already filtered by role and
   * surface on the server. Sent to a device-only room, so the desktop never
   * receives it and needs no branch to ignore it.
   */
  "device:content": (payload: {
    progress: number;
    routine: { name: string; type: RoutineType };
    elements: ElementConfig[];
    trial: number;
  }) => void;
  /** The study ended (end routine reached, or withdrawn): the phone turns its camera off. */
  "device:finished": () => void;
  "exp:data:ack": () => void;
  /** Confirms the participant's completion was persisted. */
  "exp:completed": () => void;
  "exp:alert": (payload: { message: string; type: string }) => void;
  /**
   * How many of a session's members have reached the proceed barrier. Sent to
   * the whole cohort each time somebody arrives, so a participant who has
   * submitted can be told they are waiting and the others can see that someone
   * is waiting on them. A count only — naming who has submitted would leak a
   * partner's pace in studies where that matters.
   */
  "exp:sync": (payload: {
    submitted: number;
    total: number;
    /**
     * The progress the barrier is holding at. A member still being served
     * their content for that progress receives this event BEFORE their
     * `exp:content`, so without the tag their own arriving content clears a
     * notice that is about to become true.
     */
    progress: number;
  }) => void;
  "match:waiting": (payload: { current: number; target: number }) => void;
  "match:matched": (payload: MatchedPayload) => void;
  /**
   * The waiting room timed out and this participant continues alone. Distinct
   * from `match:matched`: an empty sessionId there is indistinguishable from
   * "no session yet", which suppresses the partner-unavailable notice and
   * leaves the participant staring at a permanent waiting overlay.
   */
  "match:timeout": () => void;
  /** A message in the thread identified by `scope` (`<progress>:<groupIndex>`). */
  "chat:message": (payload: { scope: string; line: ChatLine }) => void;
  /** The buffered thread for `scope`; `scope` is `""` when this step has no chat. */
  "chat:history": (payload: { scope: string; lines: ChatLine[] }) => void;
  "signal:offer": (payload: { fromPeerId: string; sdp: RTCSessionDescriptionInit }) => void;
  "signal:answer": (payload: { fromPeerId: string; sdp: RTCSessionDescriptionInit }) => void;
  "signal:ice": (payload: { fromPeerId: string; candidate: RTCIceCandidateInit }) => void;
  "device:joined": (payload: { peerId: string; mode: "camera" | "controller" }) => void;
  "device:left": (payload: { peerId: string; mode: "camera" | "controller" }) => void;
  /** `deviceId` is the phone's socket id, in both directions; a phone ignores a signal for another phone. */
  "device:signal": (payload: DeviceSignal & { deviceId: string }) => void;
  /**
   * A control on the phone was used. The phone sends the intent only — the
   * desktop runner owns the state machine and applies it. `progress` is the
   * routine the phone believed it was on, so a press from a routine the
   * participant has left can be dropped.
   */
  "device:input": (payload: {
    elementName: string;
    trigger: EventTrigger;
    value: unknown;
    progress: number;
  }) => void;
  "device:slots-available": (payload: { slots: { slotLabel: string; capabilities: ("camera" | "microphone")[]; facingMode?: string }[] }) => void;
  "device:slot-confirmed": (payload: { slotLabel: string; capabilities: ("camera" | "microphone")[]; facingMode?: string; constraints?: Record<string, unknown> }) => void;
  "device:slot-denied": (payload: { reason: string }) => void;
  "device:slot-filled": (payload: { slotLabel: string; deviceId: string }) => void;
  "device:slot-lost": (payload: { slotLabel: string; reason: string }) => void;
  "device:text-instruction": (payload: { message: string; from: string; target?: string }) => void;
  "monitor:peer-joined": (payload: { peerId: string }) => void;
  "monitor:signal:offer": (payload: { fromParticipantId: string; sdp: RTCSessionDescriptionInit }) => void;
  "monitor:signal:answer": (payload: { fromParticipantId: string; sdp: RTCSessionDescriptionInit }) => void;
  "monitor:signal:ice": (payload: { fromParticipantId: string; candidate: RTCIceCandidateInit }) => void;
  "upload:ready": (payload: {
    uploadId: string;
    /** Set on a new upload, so one of several recordings on a socket knows the id is its own. */
    elementName?: string;
    /** Set on a new upload: the name the server stored the file under, as the ZIP export names it. */
    fileName?: string;
    bytesReceived?: number;
    lastChunkIndex?: number;
  }) => void;
  "upload:chunk:ack": (payload: {
    uploadId: string;
    chunkIndex: number;
    bytesReceived: number;
  }) => void;
  "upload:complete": (payload: { uploadId: string; filePath: string }) => void;
  "upload:error": (payload: { uploadId: string; message: string }) => void;
  error: (payload: { code: string; message: string }) => void;
}

// ── Socket Event Payloads ──────────────────────────────

export interface DataPayload {
  progress: number;
  trial: number;
  routine: string;
  response: Record<string, unknown>;
  trialInfo?: Record<string, unknown>;
}

export interface ExperimentConfigPayload {
  id: string;
  name: string;
  description: string;
  avCollection: boolean;
  bodyDetection: boolean;
  videoChat: boolean;
  supplementaryDevice: DeviceMode;
  participantsPerSession: number;
  conditions: string[];
  /** URL query parameter carrying an external participant id, e.g. "PROLIFIC_PID". */
  participantIdParam: string | null;
}

export interface JoinedPayload {
  participantId: string;
  responseId: string;
  progress: number;
  condition: string | null;
  properties: Record<string, unknown>;
}

export interface ContentPayload {
  progress: number;
  routine: {
    name: string;
    type: RoutineType;
    layout: RoutineLayout;
    matching: MatchingConfig | null;
    device: DeviceConfig | null;
    config?: RoutineSpecificConfig;
    interactionPattern?: InteractionPattern;
  };
  elements: ElementConfig[];
  /**
   * What this participant's phone is showing. The desktop does not render
   * these; it keeps them so an incoming `device:input` can be resolved back
   * to the element that sent it.
   */
  deviceElements: ElementConfig[];
  trial: number;
  trialInfo: Record<string, unknown>;
  interactionGroup?: {
    peers: string[];
    seat: number;
    groupIndex: number;
    /**
     * True when the server resolved no ACTIVE peer for this rotation even
     * though the cohort has more than one seat — i.e. this participant has been
     * left solo. Always set by the server; consumers may treat it as boolean.
     */
    partnerUnavailable?: boolean;
    /** The ACTIVE members of this group, self included, ordered by seat. */
    members?: SessionMember[];
  };
  /**
   * The whole cohort (dropped seats included), ordered by seat. Sent on every
   * delivery inside a session because `match:matched` is not re-sent when the
   * participant reloads. Absent outside a session.
   */
  sessionMembers?: SessionMember[];
  /** This participant's role in the routine; absent when the routine has no roles. */
  roleName?: string;
  /**
   * The role of each session member (participantId → role name) for a
   * video-chat routine with roles, so the call can label each video.
   * Absent otherwise.
   */
  memberRoles?: Record<string, string>;
  /**
   * `ref:` values the server could not resolve for this participant (raw
   * strings, deduplicated). Absent when everything resolved or nothing was
   * referenced. Informational: the element already rendered with an empty
   * value.
   */
  unresolvedRefs?: string[];
}

export interface MatchedPayload {
  sessionId: string;
  peers: string[];
  seat: number;
  slotName: string;
  /** The cohort just formed, self included, ordered by seat. */
  members?: SessionMember[];
}

// ── API Response Types ─────────────────────────────────

export interface AuthResponse {
  token: string;
  experimenter: {
    id: string;
    email: string;
    name: string;
  };
}

export interface ApiError {
  code: string;
  message: string;
}

// ── Admin Socket Events ───────────────────────────────

export interface QueueEntry {
  participantId: string;
  condition: string | null;
  joinedAt: number;
  /**
   * The recruitment-platform id captured via `Experiment.participantIdParam`,
   * when the experiment captures one. It is what a stranded participant will
   * quote in an email, so the dashboard shows it in preference to the internal
   * uuid, which appears nowhere the participant can see.
   */
  externalId: string | null;
}

export interface QueueStatePayload {
  experimentId: string;
  rooms: Array<{
    routineName: string;
    entries: QueueEntry[];
  }>;
}

export interface QueueUpdatePayload {
  experimentId: string;
  routineName: string;
  action: "joined" | "left" | "matched" | "timeout";
  participantId: string;
  entries: QueueEntry[];
}

export interface SessionSeatSummary {
  /**
   * 0-based, exactly as stored. Every UI surface renders it 1-based, and the
   * only place that conversion is allowed to live is `formatSeatGroups`.
   */
  seat: number;
  slotName: string | null;
  participantId: string;
  externalId: string | null;
  status: "ACTIVE" | "DROPPED";
  /** The occupant's own stored progress, so a dropped seat shows where it stopped. */
  progress: number;
}

export interface SessionGroupingSummary {
  progress: number;
  trialNumber: number;
  groupIndex: number;
  /** Seats in this group, ascending, 0-based. Parallel to participantIds. */
  seats: number[];
  participantIds: string[];
}

export interface SessionSummary {
  sessionId: string;
  experimentId: string;
  routineName: string;
  /** The owning SessionDesign's id, stamped at match time; null when no block claims the routine. */
  blockId: string | null;
  /**
   * The owning design's current label, resolved at read time so renaming a
   * block renames its live sessions. Null when the design has since been
   * deleted. Optional because it is a derived convenience, not stored state —
   * a caller assembling a SessionSummary by hand may omit it.
   */
  blockLabel?: string | null;
  status: "WAITING" | "ACTIVE" | "CLOSED";
  matchProgress: number;
  matchedAt: string | null;
  /** The full cohort as matched. Never shrinks on a dropout. */
  seatCount: number;
  activeSeatCount: number;
  /** Every seat of the cohort, ascending, dropped seats included. */
  seats: SessionSeatSummary[];
  /** Progress of the most recent grouping rows; null before the first trial. */
  currentProgress: number | null;
  currentTrialNumber: number | null;
  /** Only the most recent progress's groups — the pairing showing right now. */
  groupings: SessionGroupingSummary[];
}

export interface SessionStatePayload {
  experimentId: string;
  sessions: SessionSummary[];
}

export interface SessionUpdatePayload {
  experimentId: string;
  session: SessionSummary;
}

export interface AdminToServerEvents {
  "queue:subscribe": (data: { experimentId: string }) => void;
  "queue:unsubscribe": (data: { experimentId: string }) => void;
  "session:subscribe": (data: { experimentId: string }) => void;
  "session:unsubscribe": (data: { experimentId: string }) => void;
}

export interface AdminFromServerEvents {
  "queue:state": (data: QueueStatePayload) => void;
  "queue:update": (data: QueueUpdatePayload) => void;
  "session:state": (data: SessionStatePayload) => void;
  "session:update": (data: SessionUpdatePayload) => void;
}

// ── RTCSessionDescriptionInit / RTCIceCandidateInit ────
// These are provided by the browser's WebRTC API.
// Re-declared here for server-side (relay-only, opaque).

export interface RTCSessionDescriptionInit {
  type: "offer" | "answer";
  sdp?: string;
}

export interface RTCIceCandidateInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
}
