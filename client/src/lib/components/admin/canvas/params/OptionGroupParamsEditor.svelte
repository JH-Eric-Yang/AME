<script lang="ts">
  import type { InputOptionGroupParams } from "ame-shared";
  import SelectField from "../fields/SelectField.svelte";
  import ToggleField from "../fields/ToggleField.svelte";
  import OptionsListField from "../fields/OptionsListField.svelte";
  import RefValueField from "../fields/RefValueField.svelte";
  import { optionGroupDefaultPatch } from "$lib/admin/defaultValueField";

  let { params, onchange }: { params: InputOptionGroupParams; onchange: (patch: Partial<InputOptionGroupParams>) => void } = $props();

  const ControlTypes = [
    { value: "radio", label: "Radio (single)" },
    { value: "checkbox", label: "Checkbox (multiple)" },
    { value: "toggle", label: "Toggle buttons (single)" },
  ];
</script>

<SelectField label="Control Type" value={params.optionType ?? "radio"} options={ControlTypes} onchange={(t) => onchange({ optionType: t as InputOptionGroupParams["optionType"] })} />
<OptionsListField label="Options" value={params.options} onchange={(options) => onchange({ options })} />
<ToggleField label="Inline layout" checked={params.inline ?? false} onchange={(inline) => onchange({ inline })} />
<RefValueField
  label="Default value"
  value={params.defaultValue}
  hint={params.optionType === "checkbox"
    ? "Option values separated by commas, or an earlier answer. Unknown values are ignored."
    : "An option value, or an earlier answer. An unknown value is ignored."}
  onchange={(v) => onchange({ defaultValue: optionGroupDefaultPatch(v, params.optionType) })}
/>
