import { io, Socket } from "socket.io-client";
import { connectIceServers } from "$lib/webrtc/iceServers";
import { signalInbox } from "$lib/webrtc/signalInbox";
import type { ClientToServerEvents, ServerToClientEvents } from "ame-shared";
import { get } from "svelte/store";
import { runner, canProceed } from "$lib/stores/runner";
import { ServerUrl } from "$lib/config";
import { resolveDeviceIntent } from "$lib/device/deviceIntent";
import { recordAndFire } from "$lib/elements/fireEvents";
// Cycle with chatThread.ts (it imports emitChatSend/emitChatHistory from this
// module): both sides only call each other from inside functions, never at
// module evaluation, the same shape as RecordingManager's getSocket import.
import { chatThread } from "$lib/chat/chatThread";

type TypedClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: TypedClientSocket | null = null;

/**
 * Set once the participant has joined. Its presence marks a later exp:config as
 * a reconnect rather than a first connection.
 */
let joinedResponseId: string | null = null;
/** Kept so a reconnect rejoins with the same external identity. */
let joinedExternalId: string | undefined;

export function connect(experimentId: string): TypedClientSocket {
  if (socket?.connected) {
    socket.disconnect();
  }
  joinedResponseId = null;
  joinedExternalId = undefined;

  socket = io(`${ServerUrl}/experimentSocket`, {
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  }) as TypedClientSocket;

  // ── Server → Client event handlers ───────────────────

  // The server sends the TURN password only after this participant joins.
  socket.on("ice:servers", connectIceServers(() => socket?.emit("ice:refresh")));

  // Call signals go to the inbox, which holds any that arrive before the call
  // is ready; a partner's one offer is otherwise lost (signalInbox.ts).
  signalInbox.clear();
  socket.on("signal:offer", ({ fromPeerId, sdp }) => signalInbox.deliver({ kind: "offer", fromPeerId, sdp }));
  socket.on("signal:answer", ({ fromPeerId, sdp }) => signalInbox.deliver({ kind: "answer", fromPeerId, sdp }));
  socket.on("signal:ice", ({ fromPeerId, candidate }) => signalInbox.deliver({ kind: "ice", fromPeerId, candidate }));

  socket.on("exp:config", (config) => {
    const resuming = joinedResponseId !== null;
    runner.setConfig(config, resuming);

    // A reconnect must not strand the participant in the lobby: rejoin with the
    // known responseId so the server can restore their progress.
    if (resuming) {
      socket!.emit("exp:join", { responseId: joinedResponseId!, externalId: joinedExternalId });
    }
  });

  socket.on("exp:joined", ({ participantId, responseId, progress, condition, properties }) => {
    const resuming = joinedResponseId !== null;
    joinedResponseId = responseId;

    runner.setJoined(participantId, responseId, progress, condition, properties);
    // Store responseId for session resume
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(`ame-responseId-${experimentId}`, responseId);
    }

    // Ask for the current routine again so the participant lands where they were.
    if (resuming) {
      socket!.emit("exp:ready");
    }
  });

  socket.on("exp:content", (payload) => {
    resetProceedGuard();
    runner.setContent(payload);
    runner.setDeviceElements(payload.deviceElements);
  });

  socket.on("device:joined", ({ mode }) => {
    // Camera-mode devices (multi-capture) come and go for their own reasons;
    // only a controller pairing/unpairing should drive the pairing prompt.
    if (mode === "controller") runner.setDeviceConnected(true);
  });

  socket.on("device:left", ({ mode }) => {
    if (mode === "controller") runner.setDeviceConnected(false);
  });

  socket.on("device:input", (intent) => {
    // The phone sends the intent only; this page applies it, because the
    // runner owns the experiment's state machine and must stay the single
    // writer.
    const state = get(runner);
    const element = resolveDeviceIntent(intent, state.deviceElements, state.progress);
    if (!element) return;
    recordAndFire(element, intent.trigger, intent.value);
  });

  socket.on("exp:data:ack", () => {
    // Data confirmed saved
  });

  socket.on("exp:completed", () => {
    runner.setCompleted();
  });

  socket.on("exp:alert", ({ message, type }) => {
    if (type === "partner-withdrawn") {
      // Handled inline by the video-chat routine, not as a blocking error —
      // the session continues without the participant who left.
      runner.setPartnerDropped();
      return;
    }
    if (type === "auto-withdraw") {
      runner.setWithdrawn();
    } else if (type === "complete") {
      runner.setCompleted();
    }
    runner.setError(message);
  });

  socket.on("exp:sync", ({ submitted, total, progress }) => {
    runner.setCohortSync(submitted, total, progress);
  });

  socket.on("match:waiting", ({ current, target }) => {
    runner.setMatching(current, target);
  });

  socket.on("match:matched", ({ sessionId, peers, seat, slotName, members }) => {
    runner.setMatched(sessionId, peers, seat, slotName, members ?? []);
  });

  socket.on("match:timeout", () => {
    runner.setMatchingTimedOut();
  });

  socket.on("chat:history", (payload) => {
    chatThread.receiveHistory(payload);
  });

  socket.on("chat:message", (payload) => {
    chatThread.receiveMessage(payload);
  });

  socket.on("error", ({ code, message }) => {
    runner.setError(`${code}: ${message}`);
  });

  // ── Initialize ───────────────────────────────────────

  socket.on("connect", () => {
    socket!.emit("exp:init", { experimentId, platform: navigator.userAgent });
  });

  return socket;
}

export function getSocket(): TypedClientSocket | null {
  return socket;
}

export function joinExperiment(responseId?: string, externalId?: string) {
  joinedExternalId = externalId;
  socket?.emit("exp:join", { responseId, externalId });
}

export function emitReady() {
  socket?.emit("exp:ready");
}

let proceedUnsubscribe: (() => void) | null = null;
let proceedEmitted = false;
/** Runs just before `exp:proceed` is sent, after any upload the proceed waited for. */
let beforeProceed: (() => void) | null = null;

/**
 * Proceed once every upload of the routine is done. `onReady` runs at that
 * moment, so a caller that sends the responses then includes what a recording
 * added when its upload finished.
 */
export function emitProceed(onReady?: () => void) {
  // Guard: only one proceed per routine
  if (proceedEmitted) return;

  if (onReady) beforeProceed = onReady;

  // Signal recorders to stop; wait for uploads before actually proceeding
  runner.requestProceed();

  // If already clear to proceed, fire immediately
  if (get(canProceed)) {
    doEmitProceed();
    return;
  }

  // Otherwise, subscribe and wait for uploads to finish
  if (proceedUnsubscribe) return; // already waiting
  proceedUnsubscribe = canProceed.subscribe((ready) => {
    if (ready) {
      doEmitProceed();
    }
  });
}

function doEmitProceed() {
  if (proceedUnsubscribe) {
    proceedUnsubscribe();
    proceedUnsubscribe = null;
  }
  proceedEmitted = true;
  const ready = beforeProceed;
  beforeProceed = null;
  ready?.();
  socket?.emit("exp:proceed");
}

/** Reset proceed guard — called when new content is delivered */
export function resetProceedGuard() {
  proceedEmitted = false;
  beforeProceed = null;
}

export function emitData(progress: number, trial: number, routine: string, response: Record<string, unknown>, trialInfo?: Record<string, unknown>) {
  socket?.emit("exp:data", { progress, trial, routine, response, trialInfo });
}

export function emitConsent() {
  socket?.emit("exp:consent");
}

export function emitWithdraw() {
  socket?.emit("exp:withdraw");
}

export function emitComplete() {
  socket?.emit("exp:complete");
}

export function emitMatchJoin(routineName: string) {
  socket?.emit("match:join", { routineName });
}

export function emitChatSend(text: string) {
  socket?.emit("chat:send", { text });
}

export function emitChatHistory() {
  socket?.emit("chat:history");
}

export function disconnect() {
  joinedResponseId = null;
  socket?.disconnect();
  socket = null;
}
