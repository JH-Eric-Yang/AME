import { describe, it, expect } from "vitest";
import { resolveFinishMode } from "ame-shared";

describe("resolveFinishMode", () => {
  it("defaults to debrief when nothing is configured", () => {
    expect(resolveFinishMode(undefined)).toBe("debrief");
    expect(resolveFinishMode({})).toBe("debrief");
  });

  it("uses the explicit mode when one is set", () => {
    expect(resolveFinishMode({ finishMode: "redirect-only" })).toBe("redirect-only");
    expect(resolveFinishMode({ finishMode: "debrief" })).toBe("debrief");
  });

  describe("end routines authored before finishMode existed", () => {
    it("infers debrief-redirect from a redirect URL", () => {
      expect(resolveFinishMode({ redirectUrl: "https://example.com" })).toBe(
        "debrief-redirect",
      );
    });

    it("infers debrief when the redirect URL is empty", () => {
      expect(resolveFinishMode({ redirectUrl: null })).toBe("debrief");
      expect(resolveFinishMode({ redirectUrl: "" })).toBe("debrief");
    });
  });

  it("lets an explicit mode override an inferred one", () => {
    expect(
      resolveFinishMode({ redirectUrl: "https://example.com", finishMode: "debrief" }),
    ).toBe("debrief");
  });
});
