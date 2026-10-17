<script lang="ts">
  import type { InputTextfieldParams } from "ame-shared";
  import TextField from "../fields/TextField.svelte";
  import NumberField from "../fields/NumberField.svelte";
  import ToggleField from "../fields/ToggleField.svelte";
  import RefValueField from "../fields/RefValueField.svelte";

  let { params, onchange }: { params: InputTextfieldParams; onchange: (patch: Partial<InputTextfieldParams>) => void } = $props();
</script>

<TextField label="Placeholder" value={params.placeholder} onchange={(placeholder) => onchange({ placeholder })} />
<ToggleField label="Multiline" checked={params.multiline ?? false} onchange={(multiline) => onchange({ multiline })} />
<NumberField label="Max length (blank = no limit)" value={params.maxLength ?? null} min={1} integer onchange={(maxLength) => onchange({ maxLength })} />
<RefValueField
  label="Default value"
  value={params.defaultValue}
  hint="Text the field starts with, or an earlier answer. A pre-filled value is recorded as the answer (on the desktop screen)."
  onchange={(v) => onchange({ defaultValue: v === undefined ? undefined : String(v) })}
/>
