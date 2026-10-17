<script lang="ts">
  import type { InputFilePickerParams } from "ame-shared";
  import TextField from "../fields/TextField.svelte";
  import NumberField from "../fields/NumberField.svelte";
  import ToggleField from "../fields/ToggleField.svelte";

  let { params, onchange }: { params: InputFilePickerParams; onchange: (patch: Partial<InputFilePickerParams>) => void } = $props();

  const DefaultMaxSizeMb = 100;
</script>

<TextField label="Accepted Types (e.g. image/*,.pdf)" value={params.accept} onchange={(accept) => onchange({ accept: accept || undefined })} />
<ToggleField label="Allow multiple" checked={params.multiple ?? false} onchange={(multiple) => onchange({ multiple })} />
<NumberField label="Max Size (MB)" value={params.maxSizeMb ?? DefaultMaxSizeMb} min={1} integer onchange={(v) => onchange({ maxSizeMb: v || DefaultMaxSizeMb })} />
<TextField label="Button Label" value={params.label} onchange={(label) => onchange({ label: label || undefined })} />
