/**
 * The ICE servers a browser uses to open a WebRTC connection.
 *
 * STUN finds a direct route; it fails on networks that block one (many
 * university, company and mobile networks). TURN relays the media there.
 * The server sends the list only on a socket that joined an experiment or
 * paired a device (socket/iceServerGrant.ts), never from an open URL, so a
 * stranger cannot use the relay. The TURN password is short-lived and follows coturn's `use-auth-secret`
 * scheme: username `<expiry>:<label>`, credential base64(HMAC-SHA1(secret, username)),
 * so the shared secret never leaves the server.
 */

import { createHmac } from "node:crypto";
import type { IceServerList } from "ame-shared";

type IceServer = IceServerList["iceServers"][number];

export interface TurnSettings {
  /** Comma-separated `turn:` / `turns:` URLs; empty means no TURN. */
  urls: string;
  secret: string;
  ttlSeconds: number;
}

/** Public STUN servers; enough when both browsers can reach each other directly. */
export const StunServers: readonly IceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

/** Four hours: longer than a session, short enough that a leaked password soon stops working. The client asks for a new one before expiry. */
export const DefaultTurnTtlSeconds = 4 * 60 * 60;
const TurnUserLabel = "ame";

export function turnSettingsFromEnv(env: NodeJS.ProcessEnv): TurnSettings {
  const ttl = Number.parseInt(env.TURN_TTL_SECONDS ?? "", 10);
  return {
    urls: env.TURN_URLS ?? "",
    secret: env.TURN_SECRET ?? "",
    ttlSeconds: Number.isFinite(ttl) && ttl > 0 ? ttl : DefaultTurnTtlSeconds,
  };
}

/** STUN always; TURN too when both its URLs and its secret are set. `nowMs` is injected for tests. */
export function iceServersFor(settings: TurnSettings, nowMs: number): IceServerList {
  const urls = settings.urls.split(",").map((u) => u.trim()).filter(Boolean);
  if (urls.length === 0 || !settings.secret) return { iceServers: [...StunServers], expiresAt: null };

  const expiry = Math.floor(nowMs / 1000) + settings.ttlSeconds;
  const username = `${expiry}:${TurnUserLabel}`;
  const credential = createHmac("sha1", settings.secret).update(username).digest("base64");
  return { iceServers: [...StunServers, { urls, username, credential }], expiresAt: expiry * 1000 };
}
