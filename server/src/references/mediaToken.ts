/**
 * mediaToken — the short-lived credential that lets a participant's <video>
 * or <img> fetch one specific upload.
 *
 * A reference is authorised when it is resolved (server-side, per participant,
 * inside deliverContent). The token carries that decision to the fetch, so the
 * upload route needs no session lookup and no participant auth scheme — the
 * same reason `serveAsset` is unauthenticated, plus an expiry.
 */

import jwt from "jsonwebtoken";
import { JwtSecret } from "../middleware/auth.js";

/** How long a minted URL stays fetchable. Long enough to sit through a routine. */
export const MediaTokenTtl = "1h";

/** Distinguishes these tokens from admin session JWTs signed with the same secret. */
const TokenUse = "upload";

interface MediaClaims {
  sub: string;
  use: string;
}

export function mintMediaToken(uploadId: string): string {
  return jwt.sign({ sub: uploadId, use: TokenUse }, JwtSecret, { expiresIn: MediaTokenTtl });
}

/** The upload id the token grants, or null for anything invalid, expired or not an upload token. */
export function verifyMediaToken(token: string): string | null {
  try {
    const claims = jwt.verify(token, JwtSecret) as Partial<MediaClaims>;
    return claims.use === TokenUse && typeof claims.sub === "string" ? claims.sub : null;
  } catch {
    return null;
  }
}

/**
 * Relative, so no hostname is baked into delivered content; the client's
 * `resolveSrc` prefixes its `ServerUrl`, exactly as it does for `asset:` ids.
 */
export function mediaUrlFor(uploadId: string): string {
  return `/api/uploads/${encodeURIComponent(uploadId)}?token=${mintMediaToken(uploadId)}`;
}
