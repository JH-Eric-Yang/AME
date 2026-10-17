import type { Request, Response, NextFunction } from "express";

/**
 * A fixed-window counter, per key, held in this process's memory.
 *
 * Deliberately not Redis-backed: the deployment is a single PM2 process
 * (clustering is deferred), so one map is the whole picture. If the server is
 * ever clustered, this must move to Redis — every worker would otherwise grant
 * its own full allowance.
 *
 * The clock is a parameter rather than a call to `Date.now()` so the window
 * behaviour can be tested without fake timers.
 */

/** Entries are swept only once the map passes this size, to keep `check` O(1) in the common case. */
const SweepThreshold = 1000;

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the current window ends. Zero when allowed. */
  retryAfterSeconds: number;
}

interface Window {
  count: number;
  /** When the window this count belongs to began. */
  startedAt: number;
}

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Count one attempt against `key` and say whether it may proceed. */
  check(key: string, now: number): RateLimitDecision {
    if (this.windows.size > SweepThreshold) this.sweep(now);

    const window = this.windows.get(key);

    if (!window || now - window.startedAt >= this.windowMs) {
      this.windows.set(key, { count: 1, startedAt: now });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    window.count += 1;
    if (window.count <= this.limit) return { allowed: true, retryAfterSeconds: 0 };

    const remainingMs = window.startedAt + this.windowMs - now;
    return { allowed: false, retryAfterSeconds: Math.ceil(remainingMs / 1000) };
  }

  /** Drop windows that have already expired. */
  private sweep(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= this.windowMs) this.windows.delete(key);
    }
  }
}

/**
 * Express wrapper. Keys on the client IP; behind a proxy the app must be
 * configured to trust it, or every caller shares one bucket.
 */
export function rateLimit(limiter: FixedWindowRateLimiter, message: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip ?? "unknown";
    const decision = limiter.check(key, Date.now());

    if (decision.allowed) {
      next();
      return;
    }

    res.setHeader("Retry-After", String(decision.retryAfterSeconds));
    res.status(429).json({ code: "RATE_LIMITED", message, retryAfterSeconds: decision.retryAfterSeconds });
  };
}
