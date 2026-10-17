<script lang="ts">
  import type { InputSliderParams } from "ame-shared";
  import TextField from "../fields/TextField.svelte";
  import NumberField from "../fields/NumberField.svelte";
  import ToggleField from "../fields/ToggleField.svelte";
  import RefValueField from "../fields/RefValueField.svelte";

  let { params, onchange }: { params: InputSliderParams; onchange: (patch: Partial<InputSliderParams>) => void } = $props();
</script>

<NumberField label="Min" value={params.min ?? 0} integer onchange={(v) => onchange({ min: v ?? 0 })} />
<NumberField label="Max" value={params.max ?? 100} integer onchange={(v) => onchange({ max: v ?? 100 })} />
<NumberField label="Step" value={params.step ?? 1} min={0} onchange={(v) => onchange({ step: v ?? undefined })} />
<RefValueField
  label="Default value"
  value={params.defaultValue}
  inputType="number"
  placeholder="50"
  hint="A number, or an earlier numeric answer. A set value is recorded as the answer (on the desktop screen)."
  onchange={(v) => onchange({ defaultValue: v })}
/>
<TextField label="Left label" value={params.leftLabel} onchange={(leftLabel) => onchange({ leftLabel: leftLabel || undefined })} />
<TextField label="Right label" value={params.rightLabel} onchange={(rightLabel) => onchange({ rightLabel: rightLabel || undefined })} />
<ToggleField label="Show value" checked={params.showValue ?? true} onchange={(showValue) => onchange({ showValue })} />
