import type { Request, Response, NextFunction, RequestHandler } from "express";
import { reportError } from "../errors/reportError.js";

/**
 * Wraps an async route handler so a rejected promise reaches Express's error
 * pipeline.
 *
 * Express 4 only catches errors thrown synchronously. A rejection from an
 * `async` handler — one failed Prisma query — escapes as an unhandled
 * rejection instead: the request hangs, and under Node's default
 * `--unhandled-rejections=throw` the process exits, dropping every live
 * participant's socket. Every async handler mounted on a router must go
 * through this.
 */
export function asyncHandler<Req extends Request = Request>(
  handler: (req: Req, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req as Req, res, next).catch(next);
  };
}

/**
 * The last middleware on the app: logs the failure and answers with the API's
 * `{ code, message }` shape. The error's detail stays in the server log, never
 * in the response.
 */
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  console.error(`[HTTP] ${req.method} ${req.originalUrl} failed:`, err);
  reportError(err, { source: "SERVER_HTTP", context: { method: req.method, url: req.originalUrl } });

  // A streamed response (CSV/ZIP export) cannot switch to a JSON body once
  // its headers are out; Express's default handler aborts the connection.
  if (res.headersSent) {
    next(err);
    return;
  }

  res.status(500).json({ code: "INTERNAL", message: "Internal server error" });
}
