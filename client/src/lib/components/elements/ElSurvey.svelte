<script lang="ts">
  import type { ElementConfig, SurveyParams } from "ame-shared";
  import { runner } from "$lib/stores/runner";
  import { mountSurvey } from "$lib/surveyjs/setup";
  import { recordAndFire, submitAndProceed } from "$lib/elements/fireEvents";

  let { element }: { element: ElementConfig } = $props();
  const p = $derived(element.params as SurveyParams);

  let container: HTMLDivElement | undefined = $state();
  let completed = $state(false);

  $effect(() => {
    if (!container || !p.surveyJson) return;

    return mountSurvey(container, p.surveyJson, {
      showProgressBar: p.showProgressBar,
      submitLabel: p.submitLabel,
      onComplete: (data) => {
        completed = true;

        // Every answer is recorded under its own question name. The grouped
        // copy under the element name is left to recordAndFire, so a declared
        // data event owns it — key and multiplicity both.
        for (const [key, value] of Object.entries(data)) {
          runner.setResponse(key, value);
        }
        recordAndFire(element, "change", data);
        if (p.proceedOnComplete) submitAndProceed();
      },
    });
  });
</script>

<div class="el-survey">
  {#if p.surveyJson}
    <div bind:this={container} class="surveyjs-container"></div>
    {#if completed && !p.proceedOnComplete}
      <p class="done">Responses saved.</p>
    {/if}
  {:else}
    <p class="empty">No survey configured.</p>
  {/if}
</div>

<style>
  .el-survey {
    width: 100%;
  }
  .surveyjs-container {
    width: 100%;
  }
  .done {
    margin: 0.75rem 0 0;
    font-size: 13px;
    color: var(--gray-500);
  }
  .empty {
    font-size: 13px;
    color: var(--gray-400);
  }
</style>
