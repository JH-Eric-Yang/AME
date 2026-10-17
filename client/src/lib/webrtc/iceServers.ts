/**
 * iceServers — the STUN and TURN servers every RTCPeerConnection uses.
 *
 * The server sends a short-lived TURN password on the socket (`ice:servers`)
 * after the participant joins or the phone pairs — never to a stranger — and
 * the connections read the latest list synchronously. Before that the list is
 * STUN only, which still connects two browsers that can reach each other
 * directly.
 */

/** Public STUN servers: the list before the server sends one. */
export const DefaultIceServers: readonly RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

/** Load a new password this long before the old one expires. */
export const RefreshMarginMs = 60 * 60 * 1000;

export interface IceServerList {
  iceServers: RTCIceServer[];
  /** Epoch ms when the TURN password expires; null when there is no TURN. */
  expiresAt: number | null;
}

/** True when a loaded list has no TURN password left to rely on. */
export function needsRefresh(expiresAt: number | null, nowMs: number): boolean {
  return expiresAt !== null && nowMs >= expiresAt - RefreshMarginMs;
}

/** Accepts the server's list only when it has the expected shape. */
export function parseIceServerList(body: unknown): IceServerList | null {
  if (typeof body !== "object" || body === null) return null;
  const { iceServers, expiresAt } = body as Record<string, unknown>;
  if (!Array.isArray(iceServers) || iceServers.length === 0) return null;
  if (!iceServers.every((s) => typeof s === "object" && s !== null && "urls" in s)) return null;
  return { iceServers: iceServers as RTCIceServer[], expiresAt: typeof expiresAt === "number" ? expiresAt : null };
}

let current: IceServerList = { iceServers: [...DefaultIceServers], expiresAt: null };
let requestRefresh: (() => void) | null = null;
let refreshPending = false;

/**
 * Called by the page's socket: `apply` takes each `ice:servers` list, and
 * `refresh` asks the server for a new one (`ice:refresh`).
 */
export function connectIceServers(refresh: () => void): (body: unknown) => void {
  requestRefresh = refresh;
  return (body) => {
    const list = parseIceServerList(body);
    if (!list) return;
    current = list;
    refreshPending = false;
  };
}

/** The list for a new RTCPeerConnection; asks for a new password when the old one is about to expire. */
export function iceServers(): RTCIceServer[] {
  if (requestRefresh && !refreshPending && needsRefresh(current.expiresAt, Date.now())) {
    refreshPending = true;
    requestRefresh();
  }
  return current.iceServers;
}
