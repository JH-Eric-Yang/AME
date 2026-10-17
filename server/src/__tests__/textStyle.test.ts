import { describe, it, expect } from "vitest";
import {
  textStyleCss,
  fontFamilyPreset,
  FontFamilyPresets,
  DefaultTextStyle,
} from "ame-shared/textStyle";

describe("textStyleCss", () => {
  it("with no optional params reproduces the style ElText always applied", () => {
    expect(textStyleCss({ content: "hi" })).toBe(
      "font-size: 14px; font-weight: normal; font-style: normal; line-height: 1.6; color: #000; text-align: left;",
    );
  });

  it("omits font-family unless it is set", () => {
    expect(textStyleCss({ content: "" })).not.toContain("font-family");
    expect(textStyleCss({ content: "", fontFamily: FontFamilyPresets.serif })).toContain(
      `font-family: ${FontFamilyPresets.serif};`,
    );
  });

  it("maps every param onto its CSS property", () => {
    const css = textStyleCss({
      content: "",
      fontSize: "32px",
      fontWeight: "600",
      fontStyle: "italic",
      lineHeight: 2,
      color: "#ff0000",
      textAlign: "center",
    });
    expect(css).toContain("font-size: 32px;");
    expect(css).toContain("font-weight: 600;");
    expect(css).toContain("font-style: italic;");
    expect(css).toContain("line-height: 2;");
    expect(css).toContain("color: #ff0000;");
    expect(css).toContain("text-align: center;");
  });

  it("passes a non-px size through untouched", () => {
    expect(textStyleCss({ content: "", fontSize: "1.2rem" })).toContain("font-size: 1.2rem;");
  });

  it("emits highlight as background plus padding, and nothing for null or empty", () => {
    expect(textStyleCss({ content: "", highlight: "#ffff00" })).toContain(
      "background: #ffff00; padding: 0.25rem 0.5rem;",
    );
    expect(textStyleCss({ content: "", highlight: null })).not.toContain("background");
    expect(textStyleCss({ content: "", highlight: "" })).not.toContain("background");
  });

  it("defaults are the literal values, so a later default change is one edit", () => {
    expect(DefaultTextStyle.fontSize).toBe("14px");
    expect(DefaultTextStyle.lineHeight).toBe(1.6);
  });
});

describe("fontFamilyPreset", () => {
  it("names the preset a stored value matches", () => {
    expect(fontFamilyPreset(FontFamilyPresets.sans)).toBe("sans");
    expect(fontFamilyPreset(FontFamilyPresets.mono)).toBe("mono");
  });

  it("is custom for any other non-empty string", () => {
    expect(fontFamilyPreset("Comic Sans MS")).toBe("custom");
  });

  it("is null when nothing is stored", () => {
    expect(fontFamilyPreset(undefined)).toBeNull();
    expect(fontFamilyPreset("")).toBeNull();
  });
});
