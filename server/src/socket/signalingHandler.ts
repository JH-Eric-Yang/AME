import type { Namespace } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "ame-shared";
import prisma from "../prisma.js";
import type { TypedSocket, SocketState } from "./index.js";
import { deviceRoom, participantRoom } from "./rooms.js";
import { sendDeviceContent } from "./progressHandler.js";
import { safeOn, safeOnDisconnect } from "./safeListener.js";
import { grantIceServers } from "./iceServerGrant.js";
import { offerDeviceSlots } from "./deviceSlotHandler.js";

type TypedNamespace = Namespace<ClientToServerEvents, ServerToClientEvents>;

export function registerSignalingHandler(
  ns: TypedNamespace,
  socket: TypedSocket,
): void {
  safeOn(socket, "signal:offer", async ({ targetPeerId, sdp }) => {
    const state = socket.data as SocketState;
    if (!state.participantId) return;

    // Verify both peers are in the same session
    const valid = await verifyPeersInSameSession(state.participantId, targetPeerId);
    if (!valid) {
      socket.emit("error", { code: "UNAUTHORIZED", message: "Peers not in same session" });
      return;
    }

    // Find target socket and relay
    const room = `experiment:${state.experimentId}:${targetPeerId}`;
    ns.to(room).emit("signal:offer", {
      fromPeerId: state.participantId,
      sdp,
    });
  });

  safeOn(socket, "signal:answer", async ({ targetPeerId, sdp }) => {
    const state = socket.data as SocketState;
    if (!state.participantId) return;

    const valid = await verifyPeersInSameSession(state.participantId, targetPeerId);
    if (!valid) {
      socket.emit("error", { code: "UNAUTHORIZED", message: "Peers not in same session" });
      return;
    }

    const room = `experiment:${state.experimentId}:${targetPeerId}`;
    ns.to(room).emit("signal:answer", {
      fromPeerId: state.participantId,
      sdp,
    });
  });

  safeOn(socket, "signal:ice", async ({ targetPeerId, candidate }) => {
    const state = socket.data as SocketState;
    if (!state.participantId) return;

    const valid = await verifyPeersInSameSession(state.participantId, targetPeerId);
    if (!valid) return; // Silently drop ICE for unauthorized peers

    const room = `experiment:${state.experimentId}:${targetPeerId}`;
    ns.to(room).emit("signal:ice", {
      fromPeerId: state.participantId,
      candidate,
    });
  });

  // A phone and its own desktop. No session check: they are one participant,
  // and a participant alone has no session.
  safeOn(socket, "device:signal", ({ deviceId, ...signal }) => {
    const state = socket.data as SocketState;
    if (!state.experimentId || !state.participantId) return;

    if (state.deviceMode) {
      socket.to(participantRoom(state.experimentId, state.participantId))
        .emit("device:signal", { ...signal, deviceId: socket.id });
    } else if (deviceId) {
      ns.to(deviceRoom(state.experimentId, state.participantId))
        .emit("device:signal", { ...signal, deviceId });
    }
  });

  // Device signaling
  safeOn(socket, "device:connect", async ({ participantId, mode, element }) => {
    const state = socket.data as SocketState;
    state.participantId = participantId;
    state.deviceMode = mode;

    // Look up the participant to obtain their experimentId
    try {
      const participant = await prisma.participant.findUnique({
        where: { id: participantId },
        select: { experimentId: true },
      });
      if (participant) {
        state.experimentId = participant.experimentId;
        // A phone paired to a real participant may use the TURN relay.
        grantIceServers(socket);
      }
    } catch {
      // Non-fatal: experimentId may already be set or not required yet
    }

    // Join participant room so we can relay signals
    const room = `experiment:${state.experimentId}:${participantId}`;
    await socket.join(room);
    await socket.join(deviceRoom(state.experimentId!, participantId));

    // A phone that scanned a multi-capture QR code picks one of its slots.
    if (element && state.experimentId) offerDeviceSlots(socket, state.experimentId, participantId, element);

    // Notify desktop client
    ns.to(room).emit("device:joined", {
      peerId: socket.id,
      mode,
    });

    // The phone missed the delivery that happened before it paired.
    // A failure here must not kill the process: socket.io never awaits this
    // listener, so a rejection would be an unhandled rejection.
    try {
      await sendDeviceContent(ns, state.experimentId!, participantId);
    } catch (err) {
      console.error(`[device:connect] Failed to send content to ${participantId}'s device:`, err);
    }
  });

  safeOn(socket, "device:input", ({ elementName, trigger, value, progress }) => {
    const state = socket.data as SocketState;
    if (!state.participantId || !state.experimentId) return;

    const room = `experiment:${state.experimentId}:${state.participantId}`;
    socket.to(room).emit("device:input", { elementName, trigger, value, progress });
  });

  // ── Monitor (experimenter) events ────────────────────

  safeOn(socket, "monitor:subscribe", async ({ participantId }) => {
    const state = socket.data as SocketState;
    if (!state.experimentId) return;

    // Join participant room to receive events
    const room = `experiment:${state.experimentId}:${participantId}`;
    await socket.join(room);

    // Notify desktop that a monitor has joined
    ns.to(room).emit("monitor:peer-joined", { peerId: socket.id });
  });

  safeOn(socket, "monitor:text-instruction", ({ participantId, target, message }) => {
    const state = socket.data as SocketState;
    if (!state.experimentId) return;

    const room = `experiment:${state.experimentId}:${participantId}`;
    // Relay to all sockets in the room; devices filter by target client-side
    ns.to(room).emit("device:text-instruction", { message, from: "experimenter", target });
  });

  // Experimenter joins video chat — creates bidirectional WebRTC via monitor signaling
  safeOn(socket, "monitor:join-chat", ({ participantId }) => {
    const state = socket.data as SocketState;
    if (!state.experimentId) return;

    const room = `experiment:${state.experimentId}:${participantId}`;
    // Notify desktop that experimenter wants bidirectional chat
    ns.to(room).emit("monitor:peer-joined", { peerId: socket.id });
  });

  // Monitor WebRTC signaling (separate path, JWT-authorized via admin socket)
  safeOn(socket, "monitor:signal:offer", ({ participantId, sdp }) => {
    const state = socket.data as SocketState;
    if (!state.experimentId) return;

    const room = `experiment:${state.experimentId}:${participantId}`;
    ns.to(room).emit("monitor:signal:offer", {
      fromParticipantId: socket.id,
      sdp,
    });
  });

  safeOn(socket, "monitor:signal:answer", ({ participantId, sdp }) => {
    const state = socket.data as SocketState;
    if (!state.experimentId) return;

    const room = `experiment:${state.experimentId}:${participantId}`;
    ns.to(room).emit("monitor:signal:answer", {
      fromParticipantId: socket.id,
      sdp,
    });
  });

  safeOn(socket, "monitor:signal:ice", ({ participantId, candidate }) => {
    const state = socket.data as SocketState;
    if (!state.experimentId) return;

    const room = `experiment:${state.experimentId}:${participantId}`;
    ns.to(room).emit("monitor:signal:ice", {
      fromParticipantId: socket.id,
      candidate,
    });
  });

  // A device (camera or controller) going away — tab closed, screen locked,
  // wifi lost — is invisible to the desktop otherwise; `device:joined` has no
  // counterpart. Told over the participant room, same as `device:joined`.
  // socket.io never awaits a disconnect listener, so this stays synchronous;
  // an unhandled rejection here would take down the whole process and every
  // live participant's socket with it.
  safeOnDisconnect(socket, () => {
    const state = socket.data as SocketState;
    if (!state.deviceMode || !state.participantId || !state.experimentId) return;

    const room = `experiment:${state.experimentId}:${state.participantId}`;
    ns.to(room).emit("device:left", {
      peerId: socket.id,
      mode: state.deviceMode,
    });
  });
}

async function verifyPeersInSameSession(
  peerId1: string,
  peerId2: string,
): Promise<boolean> {
  // Check if both participants share an active session
  const sessions1 = await prisma.sessionParticipant.findMany({
    where: { participantId: peerId1 },
    select: { sessionId: true },
  });

  const sessionIds1 = sessions1.map((s) => s.sessionId);
  if (sessionIds1.length === 0) return false;

  const shared = await prisma.sessionParticipant.findFirst({
    where: {
      participantId: peerId2,
      sessionId: { in: sessionIds1 },
      session: { status: "ACTIVE" },
    },
  });

  return shared !== null;
}
