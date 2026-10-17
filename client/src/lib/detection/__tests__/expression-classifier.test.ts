import { describe, it, expect } from "vitest";
import {
  scoreExpression,
  createHoldState,
  updateHold,
  type Blendshape,
} from "../expression-classifier";

function shapes(entries: Record<string, number>): Blendshape[] {
  return Object.entries(entries).map(([categoryName, score]) => ({ categoryName, score }));
}

describe("scoreExpression", () => {
  it("scores zero when no blendshapes are detected", () => {
    expect(scoreExpression("smile", [])).toBe(0);
  });

  it("treats absent categories as zero rather than throwing", () => {
    expect(scoreExpression("smile", shapes({ jawOpen: 0.9 }))).toBe(0);
  });

  describe("smile", () => {
    it("averages the left and right mouth corners", () => {
      const score = scoreExpression("smile", shapes({ mouthSmileLeft: 0.8, mouthSmileRight: 0.6 }));
      expect(score).toBeCloseTo(0.7);
    });

    it("halves the score for a one-sided smirk", () => {
      const score = scoreExpression("smile", shapes({ mouthSmileLeft: 0.8, mouthSmileRight: 0 }));
      expect(score).toBeCloseTo(0.4);
    });
  });

  describe("frown", () => {
    it("averages the left and right mouth corners", () => {
      const score = scoreExpression("frown", shapes({ mouthFrownLeft: 0.5, mouthFrownRight: 0.9 }));
      expect(score).toBeCloseTo(0.7);
    });

    it("is unaffected by a smile", () => {
      expect(scoreExpression("frown", shapes({ mouthSmileLeft: 1, mouthSmileRight: 1 }))).toBe(0);
    });
  });

  describe("brow-raise", () => {
    it("takes the stronger of the inner and outer brow signals", () => {
      const inner = scoreExpression("brow-raise", shapes({ browInnerUp: 0.9 }));
      const outer = scoreExpression(
        "brow-raise",
        shapes({ browOuterUpLeft: 0.4, browOuterUpRight: 0.4 }),
      );
      expect(inner).toBeCloseTo(0.9);
      expect(outer).toBeCloseTo(0.4);
    });
  });

  describe("mouth-open", () => {
    it("reads jaw opening directly", () => {
      expect(scoreExpression("mouth-open", shapes({ jawOpen: 0.65 }))).toBeCloseTo(0.65);
    });
  });

  describe("eyes-closed", () => {
    it("averages both eyes so a wink does not pass as closed", () => {
      const wink = scoreExpression("eyes-closed", shapes({ eyeBlinkLeft: 1, eyeBlinkRight: 0 }));
      const blink = scoreExpression("eyes-closed", shapes({ eyeBlinkLeft: 1, eyeBlinkRight: 1 }));
      expect(wink).toBeCloseTo(0.5);
      expect(blink).toBeCloseTo(1);
    });
  });

  describe("surprise", () => {
    it("combines raised brows, open jaw and widened eyes", () => {
      const score = scoreExpression(
        "surprise",
        shapes({ browInnerUp: 0.9, jawOpen: 0.9, eyeWideLeft: 0.9, eyeWideRight: 0.9 }),
      );
      expect(score).toBeCloseTo(0.9);
    });

    it("scores low when only the jaw is open", () => {
      const score = scoreExpression("surprise", shapes({ jawOpen: 0.9 }));
      expect(score).toBeCloseTo(0.3);
    });
  });

  it("clamps scores into the 0–1 range", () => {
    const score = scoreExpression("mouth-open", shapes({ jawOpen: 1.4 }));
    expect(score).toBe(1);
  });
});

describe("updateHold", () => {
  const Threshold = 0.5;
  const Duration = 500;

  it("does not fire while the score stays below threshold", () => {
    const result = updateHold(createHoldState(), 0.2, Threshold, Duration, 1000);
    expect(result.fired).toBe(false);
    expect(result.state.heldSince).toBeNull();
  });

  it("starts the hold clock when the score first crosses the threshold", () => {
    const result = updateHold(createHoldState(), 0.7, Threshold, Duration, 1000);
    expect(result.fired).toBe(false);
    expect(result.state.heldSince).toBe(1000);
  });

  it("does not fire before the expression has been held long enough", () => {
    const started = updateHold(createHoldState(), 0.7, Threshold, Duration, 1000);
    const result = updateHold(started.state, 0.7, Threshold, Duration, 1400);
    expect(result.fired).toBe(false);
  });

  it("fires once the expression is held for the full duration", () => {
    const started = updateHold(createHoldState(), 0.7, Threshold, Duration, 1000);
    const result = updateHold(started.state, 0.7, Threshold, Duration, 1500);
    expect(result.fired).toBe(true);
    expect(result.heldFor).toBe(500);
  });

  it("fires only once while the expression is held continuously", () => {
    const started = updateHold(createHoldState(), 0.7, Threshold, Duration, 1000);
    const first = updateHold(started.state, 0.7, Threshold, Duration, 1500);
    const second = updateHold(first.state, 0.7, Threshold, Duration, 1600);
    expect(first.fired).toBe(true);
    expect(second.fired).toBe(false);
  });

  it("resets the hold clock when the expression lapses", () => {
    const started = updateHold(createHoldState(), 0.7, Threshold, Duration, 1000);
    const lapsed = updateHold(started.state, 0.1, Threshold, Duration, 1200);
    const resumed = updateHold(lapsed.state, 0.7, Threshold, Duration, 1400);

    expect(lapsed.state.heldSince).toBeNull();
    expect(resumed.state.heldSince).toBe(1400);
    expect(updateHold(resumed.state, 0.7, Threshold, Duration, 1700).fired).toBe(false);
  });

  it("can fire again after the expression lapses and returns", () => {
    let state = createHoldState();
    state = updateHold(state, 0.7, Threshold, Duration, 1000).state;
    const first = updateHold(state, 0.7, Threshold, Duration, 1500);
    state = updateHold(first.state, 0.1, Threshold, Duration, 1600).state;
    state = updateHold(state, 0.7, Threshold, Duration, 1700).state;
    const second = updateHold(state, 0.7, Threshold, Duration, 2200);

    expect(second.fired).toBe(true);
  });

  it("fires on the first frame above threshold when no hold is required", () => {
    const result = updateHold(createHoldState(), 0.7, Threshold, 0, 1000);
    expect(result.fired).toBe(true);
    expect(result.heldFor).toBe(0);
  });
});
