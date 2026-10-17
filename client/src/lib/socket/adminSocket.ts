import { io, type Socket } from "socket.io-client";
import type { AdminToServerEvents, AdminFromServerEvents } from "ame-shared";
import { auth } from "$lib/stores/auth";
import { ServerUrl } from "$lib/config";

type AdminSocket = Socket<AdminFromServerEvents, AdminToServerEvents>;


let socket: AdminSocket | null = null;

export function connectAdminSocket(): AdminSocket {
  if (socket?.connected) return socket;

  const token = auth.getToken();
  socket = io(`${ServerUrl}/adminSocket`, {
    auth: { token },
    transports: ["websocket"],
  }) as AdminSocket;

  return socket;
}

export function disconnectAdminSocket(): void {
  socket?.disconnect();
  socket = null;
}

export function getAdminSocket(): AdminSocket | null {
  return socket;
}
