<script lang="ts">
  import type { KeyboardParams } from "ame-shared";
  import TextField from "../fields/TextField.svelte";
  import SelectField from "../fields/SelectField.svelte";
  import ToggleField from "../fields/ToggleField.svelte";

  let { params, onchange }: { params: KeyboardParams; onchange: (patch: Partial<KeyboardParams>) => void } = $props();

  const RecordModes = [
    { value: "first", label: "First keypress only" },
    { value: "all", label: "All keypresses" },
  ];
</script>

<TextField label="Accepted Keys (comma-separated, blank = any)" value={(params.keys ?? []).join(",")} onchange={(text) => onchange({ keys: text.split(",").map((k) => k.trim()).filter(Boolean) })} />
<SelectField label="Record Mode" value={params.recordMode ?? "first"} options={RecordModes} onchange={(m) => onchange({ recordMode: m as "first" | "all" })} />
<ToggleField label="Case sensitive" checked={params.caseSensitive ?? false} onchange={(caseSensitive) => onchange({ caseSensitive })} />
<ToggleField label="Prevent default" checked={params.preventDefault ?? false} onchange={(preventDefault) => onchange({ preventDefault })} />
<TextField label="Hint (blank = invisible)" value={params.hint} onchange={(hint) => onchange({ hint: hint || undefined })} />
