import { Server as SocketIOServer, Socket } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "ame-shared";
import { registerExperimentHandler } from "./experimentHandler.js";
import { registerProgressHandler } from "./progressHandler.js";
import { registerDataHandler } from "./dataHandler.js";
import { registerMatchingHandler } from "./matchingHandler.js";
import { registerSignalingHandler } from "./signalingHandler.js";
import { registerIceRefresh } from "./iceServerGrant.js";
import { registerUploadHandler } from "./uploadHandler.js";
import { registerDeviceSlotHandler } from "./deviceSlotHandler.js";
import { registerChatHandler, type ChatScope } from "./chatHandler.js";
import { registerClientErrorHandler } from "./clientErrorHandler.js";
import { MemoryChatStore, type ChatStore } from "./chatStore.js";
import { startSeatSweep } from "./seatSweep.js";
import { setupAdminSocket } from "./adminHandler.js";
import type { WaitingRoomStore } from "./waitingRoomStore.js";

export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
export type TypedServer = SocketIOServer<ClientToServerEvents, ServerToClientEvents>;

/** Per-socket state stored in socket.data */
export interface SocketState {
  experimentId?: string;
  participantId?: string;
  responseId?: string;
  condition?: string | null;
  progress?: number;
  sessionId?: string;
  seat?: number;
  /** Set once this socket has gone through `device:connect` — a supplementary
   * device (camera or controller), never the participant's own connection. */
  deviceMode?: "camera" | "controller";
  /** The text-channel thread for this step's group; unset when the step has no group. */
  chat?: ChatScope;
  /** True once the socket may receive TURN passwords (socket/iceServerGrant.ts). */
  iceGranted?: boolean;
}

export function setupSocketHandlers(
  io: TypedServer,
  store: WaitingRoomStore,
  chatStore: ChatStore = new MemoryChatStore(),
): void {
  setupAdminSocket(io as unknown as import("socket.io").Server, store);
  const experimentNs = io.of("/experimentSocket");

  experimentNs.on("connection", (socket: TypedSocket) => {
    console.log(`[Socket] connected: ${socket.id}`);
    registerExperimentHandler(experimentNs, socket, store);
    registerProgressHandler(experimentNs, socket);
    registerDataHandler(experimentNs, socket);
    registerMatchingHandler(experimentNs, socket, store);
    registerSignalingHandler(experimentNs, socket);
    registerIceRefresh(socket);
    registerUploadHandler(experimentNs, socket);
    registerDeviceSlotHandler(experimentNs, socket);
    registerChatHandler(experimentNs, socket, chatStore);
    registerClientErrorHandler(socket);

    socket.on("disconnect", (reason) => {
      console.log(`[Socket] disconnected: ${socket.id} reason: ${reason}`);
    });
  });

  // The reconnect grace is a timer in this process. A restart inside the
  // window loses it, so a departed seat would sit ACTIVE for the rest of the
  // run with its cohort waiting at the barrier on somebody who has gone.
  startSeatSweep(experimentNs);
}
