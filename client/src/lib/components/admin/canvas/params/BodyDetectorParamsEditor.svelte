<script lang="ts">
  import type { BodyDetectorParams, GestureTrigger } from "ame-shared";
  import NumberField from "../fields/NumberField.svelte";
  import ToggleField from "../fields/ToggleField.svelte";
  import "../fields/fields.css";

  let { params, onchange }: { params: BodyDetectorParams; onchange: (patch: Partial<BodyDetectorParams>) => void } = $props();

  const DefaultHoldMs = 3000;
</script>

<!-- Plain select rather than SelectField: this one needs optgroups. -->
<div class="el-field">
  <label>
    <span>Gesture</span>
    <select value={params.gesture ?? "face-present"} onchange={(e) => onchange({ gesture: e.currentTarget.value as GestureTrigger })}>
      <optgroup label="Pose-based">
        <option value="face-present">Face Present</option>
        <option value="face-absent">Face Absent</option>
        <option value="hands-raised">Hands Raised (both)</option>
        <option value="hand-raised-left">Hand Raised (left)</option>
        <option value="hand-raised-right">Hand Raised (right)</option>
      </optgroup>
      <optgroup label="Hand Gestures">
        <option value="index-finger-up">Index Finger Up</option>
        <option value="thumbs-up">Thumbs Up</option>
        <option value="open-palm">Open Palm</option>
        <option value="peace-sign">Peace Sign</option>
        <option value="fist">Fist</option>
      </optgroup>
    </select>
  </label>
</div>
<NumberField label="Hold Duration (ms)" value={params.duration ?? DefaultHoldMs} min={0} step={500} integer onchange={(v) => onchange({ duration: v || DefaultHoldMs })} />
<NumberField label="Confidence Threshold" value={params.confidenceThreshold ?? 0.5} min={0} max={1} step={0.05} onchange={(v) => onchange({ confidenceThreshold: v ?? undefined })} />
<ToggleField label="Show overlay" checked={params.showOverlay ?? false} onchange={(showOverlay) => onchange({ showOverlay })} />
