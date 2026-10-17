import { writable, derived } from "svelte/store";
import type {
  RunnerState,
  ExperimentConfigPayload,
  ContentPayload,
  ElementConfig,
  RoutineType,
  RoutineLayout,
  MatchingConfig,
  DeviceConfig,
  RoutineSpecificConfig,
  SessionMember,
} from "ame-shared";
import type { CohortSync } from "$lib/matching/cohortSync";

export interface UploadState {
  status: "uploading" | "complete" | "failed";
  progress: number; // 0–100
  uploadId?: string;
}

interface RunnerStore {
  state: RunnerState;
  experimentId: string;
  participantId: string;
  responseId: string;
  condition: string | null;
  config: ExperimentConfigPayload | null;
  progress: number;
  routine: {
    name: string;
    type: RoutineType;
    layout: RoutineLayout;
    matching: MatchingConfig | null;
    device: DeviceConfig | null;
    config?: RoutineSpecificConfig;
  } | null;
  elements: ElementConfig[];
  /**
   * What this participant's phone is showing. Kept so a `device:input` can be
   * resolved back to the element that sent it.
   */
  deviceElements: ElementConfig[];
  routineStartTime: number;
  trial: number;
  trialInfo: Record<string, unknown>;
  /** This participant's role in the current routine; null when it has no roles. */
  roleName: string | null;
  /** participantId → role name for the call's video labels; empty when unknown. */
  memberRoles: Record<string, string>;
  responses: Record<string, unknown>;
  pendingUploads: Map<string, UploadState>;
  proceedRequested: boolean;
  matchingStatus: { current: number; target: number } | null;
  /**
   * How many of this session's members have reached the proceed barrier, and
   * the progress that count belongs to.
   */
  cohortSync: CohortSync | null;
  sessionId: string | null;
  peers: string[];
  seat: number | null;
  slotName: string | null;
  /**
   * The whole cohort, dropped seats included, ordered by seat. From
   * `match:matched`, and refreshed by every in-session `exp:content` so a
   * reload (which does not re-send match:matched) can still address seats.
   */
  sessionMembers: SessionMember[];
  properties: Record<string, unknown>;
  interactionGroup: {
    peers: string[];
    seat: number;
    groupIndex: number;
    /**
     * True when this seat's resolved group has no active peer left. Set by the
     * server; absent until the dropout handling ships, so the notice it drives
     * simply does not render before then.
     */
    partnerUnavailable?: boolean;
    /** The ACTIVE members of this group, self included, ordered by seat. */
    members?: SessionMember[];
  } | null;
  /** A session member withdrew or lost their connection during this routine. */
  partnerDropped: boolean;
  /** Raw `ref:` strings the server could not resolve for this routine. */
  unresolvedRefs: string[];
  /**
   * True while a controller-mode phone is paired. Set on `device:joined` and
   * cleared on `device:left`, both filtered to `mode === "controller"` — a
   * camera-mode device (multi-capture) comes and goes for its own reasons and
   * must not drive the pairing prompt. Persists across routine changes; only
   * `setContent`'s `deviceElements` reset is per-routine, this is not.
   */
  deviceConnected: boolean;
  /**
   * The waiting room timed out and this participant continues alone. Kept
   * separate from `sessionId` so "released by a timeout" and "still waiting"
   * are distinguishable — they need opposite screens.
   */
  matchingTimedOut: boolean;
  error: string | null;
}

const DefaultRunnerState: RunnerStore = {
  state: "INIT",
  experimentId: "",
  participantId: "",
  responseId: "",
  condition: null,
  config: null,
  progress: 0,
  routine: null,
  elements: [],
  deviceElements: [],
  routineStartTime: 0,
  trial: 1,
  trialInfo: {},
  roleName: null,
  memberRoles: {},
  responses: {},
  pendingUploads: new Map(),
  proceedRequested: false,
  matchingStatus: null,
  cohortSync: null,
  sessionId: null,
  peers: [],
  seat: null,
  slotName: null,
  sessionMembers: [],
  properties: {},
  interactionGroup: null,
  partnerDropped: false,
  unresolvedRefs: [],
  deviceConnected: false,
  matchingTimedOut: false,
  error: null,
};

function createRunnerStore() {
  const { subscribe, set, update } = writable<RunnerStore>({ ...DefaultRunnerState });

  return {
    subscribe,
    reset() {
      set({ ...DefaultRunnerState });
    },
    setExperimentId(id: string) {
      update((s) => ({ ...s, experimentId: id }));
    },
    /**
     * @param resuming true when this config arrives from a socket reconnect,
     *        in which case the participant keeps their place instead of being
     *        sent back to the lobby.
     */
    setConfig(config: ExperimentConfigPayload, resuming = false) {
      update((s) => ({ ...s, config, state: resuming ? s.state : "LOBBY" }));
    },
    setJoined(
      participantId: string,
      responseId: string,
      progress: number,
      condition: string | null,
      properties: Record<string, unknown>,
    ) {
      update((s) => ({ ...s, participantId, responseId, progress, condition, properties }));
    },
    setContent(payload: ContentPayload) {
      update((s) => ({
        ...s,
        state: "RUNNING",
        progress: payload.progress,
        routine: payload.routine,
        elements: payload.elements,
        // Clear the phone's list until this routine's own exp:content
        // (which carries the fresh deviceElements) arrives and repopulates it.
        deviceElements: [],
        routineStartTime: Date.now(),
        trial: payload.trial,
        trialInfo: payload.trialInfo,
        roleName: payload.roleName ?? null,
        memberRoles: payload.memberRoles ?? {},
        responses: {},
        pendingUploads: new Map(),
        proceedRequested: false,
        matchingStatus: null,
        // Keep a barrier notice that belongs to the routine now arriving. A
        // member served last in the release loop is told about the next
        // barrier BEFORE their own content lands, and clearing blindly here
        // threw that notice away — leaving them the only one not told anybody
        // was waiting on them.
        cohortSync:
          s.cohortSync?.progress === payload.progress ? s.cohortSync : null,
        interactionGroup: payload.interactionGroup ?? s.interactionGroup,
        sessionMembers: payload.sessionMembers ?? s.sessionMembers,
        // A new routine starts with a clean slate; the server re-flags the
        // orphan through interactionGroup.partnerUnavailable if they are still one.
        partnerDropped: false,
        matchingTimedOut: false,
        unresolvedRefs: payload.unresolvedRefs ?? [],
      }));
    },
    setResponse(key: string, value: unknown) {
      update((s) => ({
        ...s,
        responses: { ...s.responses, [key]: value },
      }));
    },
    /** A session member reached the proceed barrier. */
    setCohortSync(submitted: number, total: number, progress: number) {
      update((s) => ({ ...s, cohortSync: { submitted, total, progress } }));
    },
    setMatching(current: number, target: number) {
      update((s) => ({ ...s, state: "MATCHING", matchingStatus: { current, target } }));
    },
    setMatched(sessionId: string, peers: string[], seat: number, slotName: string, members: SessionMember[] = []) {
      update((s) => ({
        ...s,
        sessionId,
        peers,
        seat,
        slotName,
        sessionMembers: members,
        state: "RUNNING",
        matchingStatus: null,
        // A new session (or a cleared one, which RoutineEndMatching signals with
        // an empty sessionId) invalidates the previous block's interaction
        // group. setContent deliberately preserves a group when a payload
        // carries none, so without this clear the second matching block would
        // dial block one's dead peers — an interaction group always wins in
        // peerSelection.
        interactionGroup: null,
        matchingTimedOut: false,
      }));
    },
    /**
     * The waiting room timed out with `timeoutAction: "proceed"`. No session
     * was formed, so the participant runs the routine alone — but they leave
     * the matching screen and are told their partner never arrived.
     */
    setMatchingTimedOut() {
      update((s) => ({
        ...s,
        state: "RUNNING",
        matchingStatus: null,
        matchingTimedOut: true,
      }));
    },
    /** A session member withdrew or lost their connection. */
    setPartnerDropped() {
      update((s) => ({ ...s, partnerDropped: true }));
    },
    setProperties(properties: Record<string, unknown>) {
      update((s) => ({ ...s, properties }));
    },
    setCompleted() {
      update((s) => ({ ...s, state: "COMPLETED" }));
    },
    setWithdrawn() {
      update((s) => ({ ...s, state: "WITHDRAWN" }));
    },
    setError(error: string) {
      update((s) => ({ ...s, error }));
    },
    registerUpload(elementName: string, uploadId?: string) {
      update((s) => {
        const uploads = new Map(s.pendingUploads);
        uploads.set(elementName, { status: "uploading", progress: 0, uploadId });
        return { ...s, pendingUploads: uploads };
      });
    },
    updateUpload(elementName: string, patch: Partial<UploadState>) {
      update((s) => {
        const uploads = new Map(s.pendingUploads);
        const existing = uploads.get(elementName);
        if (existing) {
          uploads.set(elementName, { ...existing, ...patch });
        }
        return { ...s, pendingUploads: uploads };
      });
    },
    clearUploads() {
      update((s) => ({ ...s, pendingUploads: new Map() }));
    },
    requestProceed() {
      update((s) => ({ ...s, proceedRequested: true }));
    },
    setDeviceElements(elements: ElementConfig[]) {
      update((s) => ({ ...s, deviceElements: elements }));
    },
    setDeviceConnected(connected: boolean) {
      update((s) => ({ ...s, deviceConnected: connected }));
    },
  };
}

export const runner = createRunnerStore();
export const runnerState = derived(runner, ($r) => $r.state);
export const canProceed = derived(runner, ($r) => {
  if ($r.pendingUploads.size === 0) return true;
  for (const upload of $r.pendingUploads.values()) {
    if (upload.status === "uploading") return false;
  }
  return true;
});
