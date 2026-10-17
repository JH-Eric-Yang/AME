/**
 * assetAuth — who is uploading.
 *
 * tus 2.x hooks receive a web-standard Request rather than the Express one, so
 * `req.auth` from `requireAuth` is not available inside them and headers are
 * read with `.get()`. The router's `requireAuth` still rejects an anonymous
 * caller first; this is what tells the hook WHICH experimenter is calling.
 */

import { verifyToken } from "../middleware/auth.js";

const BearerPrefix = "Bearer ";

/** Rejection shape @tus/server turns into an HTTP response. */
function unauthorized(message: string) {
  return { status_code: 401, body: message };
}

/**
 * The experimenter id carried by an Authorization header.
 *
 * @throws a tus rejection when the header is absent, malformed, or the token
 *         does not verify.
 */
export function experimenterFromAuthHeader(header: string | null): string {
  if (!header?.startsWith(BearerPrefix)) {
    throw unauthorized("Missing or invalid authorization header");
  }

  try {
    return verifyToken(header.slice(BearerPrefix.length)).experimenterId;
  } catch {
    throw unauthorized("Invalid or expired token");
  }
}
