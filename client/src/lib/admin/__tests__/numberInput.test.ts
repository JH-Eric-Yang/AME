import { describe, it, expect } from "vitest";
import { correctedNumberText } from "../numberInput";

describe("correctedNumberText", () => {
  it("leaves text that already reads as the accepted number", () => {
    expect(correctedNumberText("8", 8)).toBeNull();
  });

  it("ignores surrounding whitespace, which a number input may hand back", () => {
    expect(correctedNumberText(" 8 ", 8)).toBeNull();
  });

  it("forces an emptied field back to the value the design kept", () => {
    // The C4 repro: the Cohort size field is cleared, the design still holds 8,
    // and `value={design.cohortSize}` never changes so Svelte never rewrites it.
    expect(correctedNumberText("", 8)).toBe("8");
  });

  it("forces a fractional entry back to the integer that was stored", () => {
    expect(correctedNumberText("3.5", 7)).toBe("7");
  });

  it("forces a clamped entry back to the clamped value", () => {
    expect(correctedNumberText("999", 32)).toBe("32");
  });

  it("normalises a leading zero, which is the same number but not the same text", () => {
    expect(correctedNumberText("08", 8)).toBe("8");
  });
});
