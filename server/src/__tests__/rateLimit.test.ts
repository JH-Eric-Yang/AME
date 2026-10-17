import { describe, it, expect } from "vitest";
import { FixedWindowRateLimiter } from "../middleware/rateLimit.js";

const WindowMs = 60_000;

describe("FixedWindowRateLimiter", () => {
  it("allows attempts up to the limit", () => {
    const limiter = new FixedWindowRateLimiter(3, WindowMs);

    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("a", 1).allowed).toBe(true);
    expect(limiter.check("a", 2).allowed).toBe(true);
  });

  it("refuses the one past the limit", () => {
    const limiter = new FixedWindowRateLimiter(2, WindowMs);
    limiter.check("a", 0);
    limiter.check("a", 0);

    expect(limiter.check("a", 0)).toEqual({ allowed: false, retryAfterSeconds: 60 });
  });

  it("counts each key separately, so one caller cannot lock out another", () => {
    const limiter = new FixedWindowRateLimiter(1, WindowMs);
    limiter.check("a", 0);

    expect(limiter.check("b", 0).allowed).toBe(true);
    expect(limiter.check("a", 0).allowed).toBe(false);
  });

  it("reports the time left in the window, not the whole window", () => {
    const limiter = new FixedWindowRateLimiter(1, WindowMs);
    limiter.check("a", 0);

    expect(limiter.check("a", 45_000).retryAfterSeconds).toBe(15);
  });

  it("starts a fresh window once the old one elapses", () => {
    const limiter = new FixedWindowRateLimiter(1, WindowMs);
    limiter.check("a", 0);
    expect(limiter.check("a", WindowMs - 1).allowed).toBe(false);

    expect(limiter.check("a", WindowMs).allowed).toBe(true);
  });

  it("does not carry the blocked attempts into the next window", () => {
    const limiter = new FixedWindowRateLimiter(2, WindowMs);
    for (let i = 0; i < 10; i++) limiter.check("a", 0);

    expect(limiter.check("a", WindowMs).allowed).toBe(true);
    expect(limiter.check("a", WindowMs).allowed).toBe(true);
    expect(limiter.check("a", WindowMs).allowed).toBe(false);
  });
});
