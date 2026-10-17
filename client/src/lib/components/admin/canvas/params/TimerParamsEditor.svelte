<script lang="ts">
  import type { TimerParams } from "ame-shared";
  import { DefaultTimerSeconds } from "ame-shared/timer";
  import NumberField from "../fields/NumberField.svelte";
  import SelectField from "../fields/SelectField.svelte";
  import ToggleField from "../fields/ToggleField.svelte";

  let { params, onchange }: { params: TimerParams; onchange: (patch: Partial<TimerParams>) => void } = $props();

  const FormatOptions = [
    { value: "mm:ss", label: "mm:ss" },
    { value: "seconds", label: "Seconds" },
    { value: "progress-bar", label: "Progress bar" },
  ];
</script>

<NumberField label="Duration (s)" value={params.duration ?? DefaultTimerSeconds} integer onchange={(v) => onchange({ duration: v ?? DefaultTimerSeconds })} />
<ToggleField label="Visible to participant" checked={params.visible ?? true} onchange={(visible) => onchange({ visible })} />
<SelectField label="Format" value={params.format ?? "mm:ss"} options={FormatOptions} onchange={(f) => onchange({ format: f as TimerParams["format"] })} />
<NumberField label="Warning at (s, blank = none)" value={params.warningTime ?? null} min={0} integer onchange={(v) => onchange({ warningTime: v ?? undefined })} />
