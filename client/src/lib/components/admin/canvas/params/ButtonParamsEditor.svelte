<script lang="ts">
  import type { ButtonParams, ButtonSize, ButtonAlign } from "ame-shared";
  import TextField from "../fields/TextField.svelte";
  import NumberField from "../fields/NumberField.svelte";
  import SelectField from "../fields/SelectField.svelte";
  import ToggleField from "../fields/ToggleField.svelte";
  import SegmentedField from "../fields/SegmentedField.svelte";

  let { params, onchange }: { params: ButtonParams; onchange: (patch: Partial<ButtonParams>) => void } = $props();

  /** What ElButton renders when nothing is stored for `label`. */
  const DefaultLabelPlaceholder = "Continue";
  const DefaultHoldMs = 3000;

  const StyleOptions = [
    { value: "primary", label: "Primary" },
    { value: "secondary", label: "Secondary" },
    { value: "danger", label: "Danger" },
  ];
  const SizeOptions = [
    { value: "small", label: "Small" },
    { value: "medium", label: "Medium" },
    { value: "large", label: "Large" },
  ];
  const AlignOptions = [
    { value: "left", label: "Left" },
    { value: "center", label: "Center" },
    { value: "right", label: "Right" },
  ];
</script>

<TextField label="Label" value={params.label} placeholder={DefaultLabelPlaceholder} onchange={(label) => onchange({ label })} />
<SelectField label="Style" value={params.style ?? "primary"} options={StyleOptions} onchange={(style) => onchange({ style: style as ButtonParams["style"] })} />
<TextField label="Value (stored on interaction)" value={params.value ?? ""} onchange={(value) => onchange({ value: value || null })} />
<NumberField label="Hold Duration (ms, for press trigger)" value={params.holdDuration ?? DefaultHoldMs} min={0} integer onchange={(v) => onchange({ holdDuration: v || DefaultHoldMs })} />
<NumberField label="Enable Time (ms, 0 = immediate)" value={params.enableTime ?? 0} min={0} integer onchange={(v) => onchange({ enableTime: v && v > 0 ? v : null })} />
<TextField label="Enable Elements (comma-separated names)" value={(params.enableElement ?? []).join(", ")} onchange={(text) => {
  const names = text.split(",").map((s) => s.trim()).filter(Boolean);
  onchange({ enableElement: names.length > 0 ? names : undefined });
}} />
<NumberField label="Interactable Times (0 = unlimited)" value={params.interactableTimes ?? 0} min={0} integer onchange={(v) => onchange({ interactableTimes: v || 0 })} />
<SelectField label="Size" value={params.size ?? "medium"} options={SizeOptions} onchange={(s) => onchange({ size: s as ButtonSize })} />
<SegmentedField label="Alignment" value={params.align ?? "center"} options={AlignOptions} onchange={(a) => onchange({ align: a as ButtonAlign })} />
<ToggleField label="Starts disabled" checked={params.disabled ?? false} onchange={(disabled) => onchange({ disabled })} />
