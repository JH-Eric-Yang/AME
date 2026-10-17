import { describe, it, expect } from "vitest";
import type { FreePlacement } from "ame-shared";
import { createConformGuard } from "../conformGuard";

const box = (wPct: number, hPct: number): FreePlacement => ({ xPct: 0, yPct: 0, wPct, hPct });

describe("createConformGuard", () => {
  it("allows a rewrite the first time it is proposed", () => {
    const guard = createConformGuard();
    expect(guard.claim("img-1", box(30, 15), box(30, 22.5))).toBe(true);
  });

  /**
   * The loop this exists to stop: an unchanged element proposing the same
   * rewrite on every render.
   */
  it("refuses the same rewrite from the same box", () => {
    const guard = createConformGuard();
    guard.claim("img-1", box(30, 15), box(30, 22.5));
    expect(guard.claim("img-1", box(30, 15), box(30, 22.5))).toBe(false);
    expect(guard.claim("img-1", box(30, 15), box(30, 22.5))).toBe(false);
  });

  it("keeps each element's history to itself", () => {
    const guard = createConformGuard();
    guard.claim("img-1", box(30, 15), box(30, 22.5));
    expect(guard.claim("img-2", box(30, 15), box(30, 22.5))).toBe(true);
  });

  /**
   * A researcher who resizes and then comes back to a width they used before
   * must still get the box conformed — the guard is against repetition of an
   * unchanged situation, not against ever repeating a value.
   */
  it("allows the same target again once the box has moved in between", () => {
    const guard = createConformGuard();
    guard.claim("img-1", box(30, 15), box(30, 22.5));
    expect(guard.claim("img-1", box(50, 40), box(50, 37.5))).toBe(true);
    expect(guard.claim("img-1", box(30, 15), box(30, 22.5))).toBe(true);
  });

  it("forgets an element on request", () => {
    const guard = createConformGuard();
    guard.claim("img-1", box(30, 15), box(30, 22.5));
    guard.forget("img-1");
    expect(guard.claim("img-1", box(30, 15), box(30, 22.5))).toBe(true);
  });

  it("handles an element that had no placement to start from", () => {
    const guard = createConformGuard();
    expect(guard.claim("img-1", undefined, box(30, 22.5))).toBe(true);
    expect(guard.claim("img-1", undefined, box(30, 22.5))).toBe(false);
  });
});
