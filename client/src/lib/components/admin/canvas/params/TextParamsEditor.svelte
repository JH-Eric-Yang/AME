<script lang="ts">
  import type { TextParams, TextAlign, FontStyle } from "ame-shared";
  import { FontFamilyPresets, fontFamilyPreset, DefaultTextStyle } from "ame-shared/textStyle";
  import { parsePx, formatPx } from "$lib/admin/fontSizeField";
  import { useRefPicker } from "$lib/admin/refPickerContext";
  import { insertAt } from "$lib/admin/textInsert";
  import TextField from "../fields/TextField.svelte";
  import NumberField from "../fields/NumberField.svelte";
  import SelectField from "../fields/SelectField.svelte";
  import ColorField from "../fields/ColorField.svelte";
  import SegmentedField from "../fields/SegmentedField.svelte";
  import "../fields/fields.css";

  let { params, onchange }: { params: TextParams; onchange: (patch: Partial<TextParams>) => void } = $props();

  const picker = useRefPicker();
  let contentBox: HTMLTextAreaElement | undefined = $state();

  const FamilyOptions = [
    { value: "sans", label: "Sans" },
    { value: "serif", label: "Serif" },
    { value: "mono", label: "Monospace" },
    { value: "custom", label: "Custom…" },
  ];
  const WeightOptions = [
    { value: "normal", label: "Normal" },
    { value: "500", label: "Medium" },
    { value: "600", label: "Semibold" },
    { value: "bold", label: "Bold" },
  ];
  const StyleOptions = [
    { value: "normal", label: "Normal" },
    { value: "italic", label: "Italic" },
  ];
  const AlignOptions = [
    { value: "left", label: "Left" },
    { value: "center", label: "Center" },
    { value: "right", label: "Right" },
    { value: "justify", label: "Justify" },
  ];

  /** Size field bounds, in px. */
  const MinFontPx = 8;
  const MaxFontPx = 200;
  /** Line-height bounds, unitless. */
  const MinLineHeight = 0.8;
  const MaxLineHeight = 3;

  // Whether the researcher picked "Custom…" but hasn't typed a stack yet.
  // An empty string can't serve as that sentinel: fontFamilyPreset("") treats
  // "" the same as unset (null), so storing "" would snap the select straight
  // back to "sans" instead of staying on "Custom…". This flag is UI-only and
  // never persisted. It initialises from the stored value so an element that
  // arrives with a custom stack keeps the field open when the researcher
  // clears it; the initial value is read once on mount, which is fine because
  // the Inspector remounts this editor per element via `{#key}`.
  // svelte-ignore state_referenced_locally -- a deliberate mount-time snapshot: the
  // Inspector remounts this editor per element (its {#key}), so reading the prop once here is the point.
  let customChosen = $state(fontFamilyPreset(params.fontFamily) === "custom");

  // Unset → "sans" is SHOWN but nothing is stored until the researcher
  // chooses, so an untouched element keeps following the page font. The flag
  // wins over a stored preset so choosing "Custom…" always reveals the text
  // field — even when a preset (e.g. Serif) is currently stored, in which
  // case the field starts from that stored stack as text to edit.
  const family = $derived(customChosen ? "custom" : (fontFamilyPreset(params.fontFamily) ?? "sans"));
  const sizePx = $derived(parsePx(params.fontSize));
  const sizeHint = $derived(
    params.fontSize && sizePx === null ? `stored as ${params.fontSize}` : undefined,
  );

  function chooseFamily(choice: string) {
    if (choice === "custom") {
      // Reveal the custom text field; store nothing until the researcher types a stack.
      customChosen = true;
      return;
    }
    customChosen = false;
    onchange({ fontFamily: FontFamilyPresets[choice as keyof typeof FontFamilyPresets] });
  }

  function insertReference() {
    picker?.open({
      kind: null,
      onpick: (ref) => {
        const start = contentBox?.selectionStart ?? -1;
        const end = contentBox?.selectionEnd ?? -1;
        const { text } = insertAt(params.content ?? "", start, end, `{{${ref}}}`);
        onchange({ content: text });
      },
    });
  }
</script>

<div class="el-field">
  <label>
    <span>Content</span>
    <textarea bind:this={contentBox} rows="4" value={params.content ?? ""} oninput={(e) => onchange({ content: e.currentTarget.value })}></textarea>
  </label>
</div>
{#if picker}
  <button type="button" class="btn-ref" onclick={insertReference}>Insert reference&hellip;</button>
{/if}

<p class="group-heading">Typography</p>

<SelectField label="Family" value={family} options={FamilyOptions} onchange={chooseFamily} />
{#if family === "custom"}
  <TextField label="Custom family" value={params.fontFamily} placeholder="e.g. 'Helvetica Neue', Arial, sans-serif" onchange={(fontFamily) => onchange({ fontFamily: fontFamily || undefined })} />
{/if}
<NumberField
  label="Size"
  value={sizePx}
  min={MinFontPx}
  max={MaxFontPx}
  placeholder={parsePx(DefaultTextStyle.fontSize)?.toString()}
  hint={sizeHint ?? "px"}
  onchange={(n) => onchange({ fontSize: n === null ? undefined : formatPx(n) })}
/>
<SelectField label="Weight" value={params.fontWeight ?? DefaultTextStyle.fontWeight} options={WeightOptions} onchange={(fontWeight) => onchange({ fontWeight })} />
<SelectField label="Style" value={params.fontStyle ?? DefaultTextStyle.fontStyle} options={StyleOptions} onchange={(s) => onchange({ fontStyle: s as FontStyle })} />
<NumberField
  label="Line height"
  value={params.lineHeight ?? null}
  min={MinLineHeight}
  max={MaxLineHeight}
  step={0.1}
  placeholder={DefaultTextStyle.lineHeight.toString()}
  onchange={(n) => onchange({ lineHeight: n ?? undefined })}
/>
<ColorField label="Colour" value={params.color} fallback="#000000" onchange={(c) => onchange({ color: c ?? undefined })} />
<ColorField label="Highlight" value={params.highlight} fallback="#ffff00" clearable onchange={(highlight) => onchange({ highlight })} />
<SegmentedField label="Alignment" value={params.textAlign ?? DefaultTextStyle.textAlign} options={AlignOptions} onchange={(a) => onchange({ textAlign: a as TextAlign })} />

<style>
  .group-heading {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--gray-400);
    margin: 0.75rem 0 0.35rem;
  }
  .btn-ref { font-size: 12px; padding: 2px 8px; margin: -0.25rem 0 0.5rem; border: 1px solid var(--gray-200); background: #fff; cursor: pointer; }
</style>
