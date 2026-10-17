<script lang="ts">
  import type { RoutineSurveyConfig } from "ame-shared";
  import { runner } from "$lib/stores/runner";
  import * as socket from "$lib/socket/experimentSocket";
  import { mountSurvey } from "$lib/surveyjs/setup";
  import LayoutGrid from "./LayoutGrid.svelte";
  import ElementRenderer from "../elements/ElementRenderer.svelte";

  const config = $derived(($runner.routine?.config ?? {}) as RoutineSurveyConfig);
  const hasSurvey = $derived(config.surveyJson !== null && config.surveyJson !== undefined);
  const hasElements = $derived($runner.elements.length > 0);

  let surveyContainer: HTMLDivElement | undefined = $state();
  let surveyCompleted = $state(false);
  let surveyResponses: Record<string, unknown> = $state({});

  // Mount SurveyJS when container is available and surveyJson exists
  $effect(() => {
    if (!surveyContainer || !hasSurvey || !config.surveyJson) return;

    // With AME elements alongside, capture responses and wait for the unified
    // submit button. Survey-only mode submits and proceeds straight away.
    const onComplete = hasElements
      ? (data: Record<string, unknown>) => {
          surveyResponses = data;
          surveyCompleted = true;
          for (const [key, value] of Object.entries(data)) {
            runner.setResponse(key, value);
          }
        }
      : (data: Record<string, unknown>) => {
          const merged = { ...$runner.responses, ...data };
          socket.emitData(
            $runner.progress,
            $runner.trial,
            $runner.routine?.name ?? "",
            merged,
            $runner.trialInfo,
          );
          socket.emitProceed();
        };

    return mountSurvey(surveyContainer, config.surveyJson, {
      showProgressBar: config.showProgressBar,
      submitLabel: config.submitLabel,
      onComplete,
    });
  });

  // Fallback: AME-elements-only mode (no surveyJson)
  let allAnswered = $derived(() => {
    const inputTypes = ["input-textfield", "input-select", "input-slider", "button"];
    const inputs = $runner.elements.filter((e) => inputTypes.includes(e.type));
    if (inputs.length === 0) return true;
    return inputs.every((e) => $runner.responses[e.name] !== undefined);
  });

  function handleSubmit() {
    socket.emitData(
      $runner.progress,
      $runner.trial,
      $runner.routine?.name ?? "",
      $runner.responses,
      $runner.trialInfo,
    );
    socket.emitProceed();
  }

  // Hybrid mode: survey completed + AME elements present
  function handleHybridSubmit() {
    const merged = { ...surveyResponses, ...$runner.responses };
    socket.emitData(
      $runner.progress,
      $runner.trial,
      $runner.routine?.name ?? "",
      merged,
      $runner.trialInfo,
    );
    socket.emitProceed();
  }
</script>

<div class="survey-wrapper">
  <div class="survey-card" style="max-width: {config.width ?? '700px'};">
    {#if hasSurvey}
      <!-- SurveyJS renders here -->
      <div bind:this={surveyContainer} class="surveyjs-container"></div>

      {#if hasElements}
        <!-- AME elements alongside the survey -->
        <div class="ame-elements-section">
          {#if $runner.routine?.layout}
            <LayoutGrid layout={$runner.routine.layout} elements={$runner.elements} />
          {:else}
            {#each $runner.elements as element (`${$runner.progress}:${element.name}`)}
              <div class="survey-item">
                <ElementRenderer {element} />
              </div>
            {/each}
          {/if}
        </div>

        {#if surveyCompleted}
          <div class="survey-actions">
            <button class="btn-primary" onclick={handleHybridSubmit}>
              Submit All
            </button>
          </div>
        {/if}
      {/if}
    {:else}
      <!-- Fallback: AME-elements-only mode (backward compatible) -->
      {#if $runner.routine?.layout}
        <LayoutGrid layout={$runner.routine.layout} elements={$runner.elements} />
      {:else}
        {#each $runner.elements as element, i (`${$runner.progress}:${element.name}`)}
          <div class="survey-item" class:first={i === 0}>
            <ElementRenderer {element} />
          </div>
        {/each}
      {/if}

      <div class="survey-actions">
        <button class="btn-primary" onclick={handleSubmit}>
          Next &rarr;
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .survey-wrapper {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    min-height: 100vh;
    padding: 2rem 1rem;
  }
  .survey-card {
    width: 100%;
    padding: 2rem;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-sm);
  }
  .surveyjs-container {
    width: 100%;
  }
  .ame-elements-section {
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--gray-200);
  }
  .survey-item {
    margin-bottom: 1.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--gray-100);
  }
  .survey-item.first {
    border-top: none;
    padding-top: 0;
  }
  .survey-actions {
    margin-top: 2rem;
    text-align: center;
  }
  .btn-primary {
    background: var(--black);
    color: #fff;
    padding: 0.75rem 2rem;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 14px;
    cursor: pointer;
  }
</style>
