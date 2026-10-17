/**
 * iceServerGrant — who gets the TURN password.
 *
 * Only a socket that joined an experiment as a participant, or paired a phone
 * to a real participant, receives `ice:servers`. A stranger with no
 * experiment link and no participant cannot get a password and so cannot use
 * the relay for their own traffic.
 */

import { iceServersFor, turnSettingsFromEnv } from "../iceServers.js";
import type { TypedSocket, SocketState } from "./index.js";
import { safeOn } from "./safeListener.js";

function sendIceServers(socket: TypedSocket): void {
  socket.emit("ice:servers", iceServersFor(turnSettingsFromEnv(process.env), Date.now()));
}

/** Marks the socket as allowed and sends the first list. */
export function grantIceServers(socket: TypedSocket): void {
  (socket.data as SocketState).iceGranted = true;
  sendIceServers(socket);
}

/** `ice:refresh` sends a new list, only to a socket that `grantIceServers` allowed. */
export function registerIceRefresh(socket: TypedSocket): void {
  safeOn(socket, "ice:refresh", () => {
    if ((socket.data as SocketState).iceGranted) sendIceServers(socket);
  });
}
