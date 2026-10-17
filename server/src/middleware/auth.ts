import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

/** Signs development tokens only; production refuses to start without JWT_SECRET. */
const DevJwtSecret = "dev-secret-change-in-production";

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  // A public default secret would let anyone sign an admin token.
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is not set: the server cannot sign login tokens in production");
  }
  return DevJwtSecret;
}

export const JwtSecret = resolveJwtSecret();
const TokenExpiryHours = "12h";
/** A download token only has to last from the click to the start of the download. */
const DownloadTokenExpiry = "5m";
const DownloadPurpose = "download";

export interface AuthPayload {
  experimenterId: string;
  email: string;
  role?: string;
}

export interface AuthRequest extends Request {
  auth?: AuthPayload;
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JwtSecret, { expiresIn: TokenExpiryHours });
}

/**
 * A token for one experiment's export downloads. A browser download (a link,
 * `window.open`) cannot send a header, so it carries this in `?token=`; the
 * 12-hour login token never goes into a URL, where server logs would keep it.
 */
export function signDownloadToken(experimenterId: string, experimentId: string): string {
  return jwt.sign({ experimenterId, experimentId, purpose: DownloadPurpose }, JwtSecret, {
    expiresIn: DownloadTokenExpiry,
  });
}

/**
 * For export routes only: the usual header, or a download token for the
 * experiment in `:id`. A login token in the URL is refused.
 */
export function requireAuthOrDownloadToken(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.headers.authorization) {
    requireAuth(req, res, next);
    return;
  }

  const token = typeof req.query.token === "string" ? req.query.token : "";
  try {
    const payload = jwt.verify(token, JwtSecret) as { experimenterId?: string; experimentId?: string; purpose?: string };
    if (payload.purpose !== DownloadPurpose || payload.experimentId !== req.params.id || !payload.experimenterId) {
      throw new Error("Not a download token for this experiment");
    }
    req.auth = { experimenterId: payload.experimenterId, email: "" };
    next();
  } catch {
    res.status(401).json({ code: "UNAUTHORIZED", message: "Invalid or expired download token" });
  }
}

/**
 * A login token, and only a login token. Download and media tokens are signed
 * with the same secret but travel in URLs (a media token reaches every
 * participant), so a token with a `purpose` or `use` claim, or with no
 * experimenter, is refused.
 */
export function verifyToken(token: string): AuthPayload {
  const payload = jwt.verify(token, JwtSecret) as Partial<AuthPayload> & { purpose?: unknown; use?: unknown };
  if (payload.purpose !== undefined || payload.use !== undefined || typeof payload.experimenterId !== "string") {
    throw new Error("Not a login token");
  }
  return payload as AuthPayload;
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ code: "UNAUTHORIZED", message: "Missing or invalid authorization header" });
    return;
  }

  const token = header.slice(7);
  try {
    req.auth = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ code: "UNAUTHORIZED", message: "Invalid or expired token" });
  }
}

/**
 * Restricts a route to ADMIN experimenters. Must run after `requireAuth`,
 * which is what puts `req.auth` there.
 */
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.auth?.role !== "ADMIN") {
    res.status(403).json({ code: "FORBIDDEN", message: "Administrator access required" });
    return;
  }

  next();
}
