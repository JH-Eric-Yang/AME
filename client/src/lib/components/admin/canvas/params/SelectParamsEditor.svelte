<script lang="ts">
  import type { InputSelectParams } from "ame-shared";
  import OptionsListField from "../fields/OptionsListField.svelte";
  import RefValueField from "../fields/RefValueField.svelte";

  let { params, onchange }: { params: InputSelectParams; onchange: (patch: Partial<InputSelectParams>) => void } = $props();
</script>

<OptionsListField label="Options" value={params.options} onchange={(options) => onchange({ options })} />
<RefValueField
  label="Default option"
  value={params.defaultValue}
  hint="An option value, or an earlier answer. A value that matches no option is ignored."
  onchange={(v) => onchange({ defaultValue: v === undefined ? undefined : String(v) })}
/>
