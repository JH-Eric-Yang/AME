/**
 * conformGuard — the stop on an element rewriting itself forever.
 *
 * Conforming a box to its media is a write made in response to reading the
 * elements, and the write comes straight back as new props. That is a loop
 * unless something makes the second pass a no-op. Two things do:
 *
 *  1. `conformTarget` is idempotent — the placement it returns already
 *     conforms, so asked again about its own answer it says "nothing to do".
 *     That is the real guard, and it is tested in the shared suite.
 *  2. This, which refuses to make the same rewrite from the same box twice.
 *     It exists because (1) fails silently and expensively: if a write ever
 *     failed to land verbatim — a rounding change, a store that normalises —
 *     the canvas would rewrite the element on every frame, and the symptom
 *     would be a render storm rather than an error.
 *
 * It is keyed on the box the rewrite starts FROM as well as the one it goes
 * to, so a researcher who drags a box back to a width it held earlier still
 * gets it conformed. Only a genuinely unchanged situation is refused.
 */

import type { FreePlacement } from "ame-shared";

function key(p: FreePlacement | undefined): string {
  return p ? `${p.xPct},${p.yPct},${p.wPct},${p.hPct}` : "none";
}

export interface ConformGuard {
  /** Whether this rewrite is worth making, recording it if so. */
  claim(elementName: string, from: FreePlacement | undefined, to: FreePlacement): boolean;
  /** Forget an element, so a later identical rewrite is allowed again. */
  forget(elementName: string): void;
}

export function createConformGuard(): ConformGuard {
  const attempted = new Map<string, string>();
  return {
    claim(elementName, from, to) {
      const signature = `${key(from)}->${key(to)}`;
      if (attempted.get(elementName) === signature) return false;
      attempted.set(elementName, signature);
      return true;
    },
    forget(elementName) {
      attempted.delete(elementName);
    },
  };
}
