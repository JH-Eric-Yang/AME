/**
 * The one place a text element's inline style is derived from its params.
 *
 * ElText renders through this, and so do the two builder surfaces that mount
 * ElText — the canvas preview and the Inspector's overflow probe — which is
 * what keeps a researcher's screen and a participant's screen in agreement.
 * The Inspector never re-derives styling on its own.
 */
import type { TextParams } from "./types";

/** Font-family stacks the builder offers by name. Any other string is "custom". */
export const FontFamilyPresets = {
  sans: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, 'SF Mono', Menlo, monospace",
} as const;

export type FontFamilyPreset = keyof typeof FontFamilyPresets;

/**
 * The values ElText applied before any of this was configurable. An
 * experiment that never set a size follows these, exactly as it did before.
 */
export const DefaultTextStyle = {
  fontSize: "14px",
  fontWeight: "normal",
  fontStyle: "normal",
  lineHeight: 1.6,
  color: "#000",
  textAlign: "left",
} as const;

/** Inline `style` for a text element — defaults filled, unset optionals omitted. */
export function textStyleCss(p: TextParams): string {
  const rules: string[] = [];
  if (p.fontFamily) rules.push(`font-family: ${p.fontFamily}`);
  rules.push(`font-size: ${p.fontSize ?? DefaultTextStyle.fontSize}`);
  rules.push(`font-weight: ${p.fontWeight ?? DefaultTextStyle.fontWeight}`);
  rules.push(`font-style: ${p.fontStyle ?? DefaultTextStyle.fontStyle}`);
  rules.push(`line-height: ${p.lineHeight ?? DefaultTextStyle.lineHeight}`);
  rules.push(`color: ${p.color ?? DefaultTextStyle.color}`);
  rules.push(`text-align: ${p.textAlign ?? DefaultTextStyle.textAlign}`);
  if (p.highlight) rules.push(`background: ${p.highlight}`, "padding: 0.25rem 0.5rem");
  return `${rules.join("; ")};`;
}

/**
 * Which preset a stored family is, "custom" for any other string, null when
 * unset. The builder's Family select is driven by this so an experiment whose
 * author typed their own stack shows that stack rather than a wrong preset.
 */
export function fontFamilyPreset(value: string | undefined): FontFamilyPreset | "custom" | null {
  if (!value) return null;
  const match = (Object.keys(FontFamilyPresets) as FontFamilyPreset[]).find(
    (key) => FontFamilyPresets[key] === value,
  );
  return match ?? "custom";
}
