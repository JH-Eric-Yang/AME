<script lang="ts">
  import type { SurveyParams } from "ame-shared";
  import TextField from "../fields/TextField.svelte";
  import SelectField from "../fields/SelectField.svelte";
  import ToggleField from "../fields/ToggleField.svelte";
  import "../fields/fields.css";

  let { params, onchange }: { params: SurveyParams; onchange: (patch: Partial<SurveyParams>) => void } = $props();

  const ProgressBarOptions = [
    { value: "off", label: "Off" },
    { value: "top", label: "Top" },
    { value: "bottom", label: "Bottom" },
  ];
</script>

<div class="el-field">
  <label>
    <span>Survey JSON</span>
    <textarea rows="8" value={params.surveyJson ? JSON.stringify(params.surveyJson, null, 2) : ""} oninput={(e) => {
      try {
        onchange({ surveyJson: JSON.parse(e.currentTarget.value) });
      } catch {
        /* keep last valid JSON while typing */
      }
    }}></textarea>
  </label>
</div>
<TextField label="Submit Label" value={params.submitLabel} onchange={(submitLabel) => onchange({ submitLabel: submitLabel || undefined })} />
<SelectField label="Progress Bar" value={params.showProgressBar ?? "off"} options={ProgressBarOptions} onchange={(v) => onchange({ showProgressBar: v as SurveyParams["showProgressBar"] })} />
<ToggleField label="Proceed on complete" hint="Ticked: advance on submit. Unticked: wait for another element." checked={params.proceedOnComplete ?? false} onchange={(proceedOnComplete) => onchange({ proceedOnComplete })} />
