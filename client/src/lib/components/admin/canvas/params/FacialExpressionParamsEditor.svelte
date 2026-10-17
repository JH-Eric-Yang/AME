<script lang="ts">
  import type { FacialExpressionDetectorParams, FacialExpression } from "ame-shared";
  import TextField from "../fields/TextField.svelte";
  import NumberField from "../fields/NumberField.svelte";
  import SelectField from "../fields/SelectField.svelte";
  import ToggleField from "../fields/ToggleField.svelte";

  let { params, onchange }: { params: FacialExpressionDetectorParams; onchange: (patch: Partial<FacialExpressionDetectorParams>) => void } = $props();

  const Modes = [
    { value: "trigger", label: "Trigger — fire events on a held expression" },
    { value: "log", label: "Log — record raw blendshape timeline" },
  ];
  const Expressions = [
    { value: "smile", label: "Smile" },
    { value: "frown", label: "Frown" },
    { value: "brow-raise", label: "Brow Raise" },
    { value: "mouth-open", label: "Mouth Open" },
    { value: "eyes-closed", label: "Eyes Closed" },
    { value: "surprise", label: "Surprise" },
  ];
  const DefaultHoldMs = 500;
  const DefaultSampleRateHz = 10;

  const mode = $derived(params.mode ?? "trigger");
</script>

<SelectField label="Mode" value={mode} options={Modes} onchange={(m) => onchange({ mode: m as "trigger" | "log" })} />
{#if mode === "trigger"}
  <SelectField label="Expression" value={params.expression ?? "smile"} options={Expressions} onchange={(e) => onchange({ expression: e as FacialExpression })} />
  <NumberField label="Threshold (0–1)" value={params.threshold ?? 0.5} min={0} max={1} step={0.05} onchange={(v) => onchange({ threshold: v ?? undefined })} />
  <NumberField label="Hold Duration (ms)" value={params.duration ?? DefaultHoldMs} min={0} step={100} integer onchange={(v) => onchange({ duration: v || 0 })} />
{:else}
  <NumberField label="Sample Rate (Hz)" value={params.sampleRate ?? DefaultSampleRateHz} min={1} max={60} integer onchange={(v) => onchange({ sampleRate: v || DefaultSampleRateHz })} />
  <TextField label="Blendshapes (comma-separated, blank = all 52)" value={(params.blendshapes ?? []).join(",")} onchange={(text) => onchange({ blendshapes: text.split(",").map((b) => b.trim()).filter(Boolean) })} />
{/if}
<ToggleField label="Show overlay" checked={params.showOverlay ?? false} onchange={(showOverlay) => onchange({ showOverlay })} />
