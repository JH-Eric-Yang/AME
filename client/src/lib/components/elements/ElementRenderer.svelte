<script lang="ts">
  import type { ElementConfig } from "ame-shared";
  import { runner } from "$lib/stores/runner";
  import TimedElement from "./TimedElement.svelte";
  import ElText from "./ElText.svelte";
  import ElImage from "./ElImage.svelte";
  import ElVideo from "./ElVideo.svelte";
  import ElAudio from "./ElAudio.svelte";
  import ElButton from "./ElButton.svelte";
  import ElRecorder from "./ElRecorder.svelte";
  import ElInputTextfield from "./ElInputTextfield.svelte";
  import ElInputSelect from "./ElInputSelect.svelte";
  import ElInputSlider from "./ElInputSlider.svelte";
  import ElTimer from "./ElTimer.svelte";
  import ElBodyDetector from "./ElBodyDetector.svelte";
  import ElVolumeCheck from "./ElVolumeCheck.svelte";
  import ElSpeechRecognizer from "./ElSpeechRecognizer.svelte";
  import ElVideoChat from "./ElVideoChat.svelte";
  import ElMultiCapture from "./ElMultiCapture.svelte";
  import ElKeyboard from "./ElKeyboard.svelte";
  import ElInputOptionGroup from "./ElInputOptionGroup.svelte";
  import ElInputFilePicker from "./ElInputFilePicker.svelte";
  import ElSurvey from "./ElSurvey.svelte";
  import ElFacialExpressionDetector from "./ElFacialExpressionDetector.svelte";

  let { element }: { element: ElementConfig } = $props();

  const hasTiming = $derived(
    (element.onsetTime != null && element.onsetTime > 0) ||
    (element.duration != null && element.duration > 0)
  );
</script>

{#snippet elementContent()}
  {#if element.type === "text"}
    <ElText {element} />
  {:else if element.type === "image"}
    <ElImage {element} />
  {:else if element.type === "video"}
    <ElVideo {element} />
  {:else if element.type === "audio"}
    <ElAudio {element} />
  {:else if element.type === "button"}
    <ElButton {element} />
  {:else if element.type === "recorder"}
    <ElRecorder {element} />
  {:else if element.type === "input-textfield"}
    <ElInputTextfield {element} />
  {:else if element.type === "input-select"}
    <ElInputSelect {element} />
  {:else if element.type === "input-slider"}
    <ElInputSlider {element} />
  {:else if element.type === "timer"}
    <ElTimer {element} />
  {:else if element.type === "body-detector"}
    <ElBodyDetector {element} />
  {:else if element.type === "volume-check"}
    <ElVolumeCheck {element} />
  {:else if element.type === "speech-recognizer"}
    <ElSpeechRecognizer {element} />
  {:else if element.type === "video-chat"}
    <ElVideoChat {element} />
  {:else if element.type === "multi-capture"}
    <ElMultiCapture {element} />
  {:else if element.type === "keyboard"}
    <ElKeyboard {element} />
  {:else if element.type === "input-option-group"}
    <ElInputOptionGroup {element} />
  {:else if element.type === "input-file-picker"}
    <ElInputFilePicker {element} />
  {:else if element.type === "survey"}
    <ElSurvey {element} />
  {:else if element.type === "facial-expression-detector"}
    <ElFacialExpressionDetector {element} />
  {:else}
    <p>Unknown element: {element.type}</p>
  {/if}
{/snippet}

{#if hasTiming}
  <TimedElement
    onsetTime={element.onsetTime}
    duration={element.duration}
    disappearMode={element.disappearMode}
    routineStartTime={$runner.routineStartTime}
  >
    {@render elementContent()}
  </TimedElement>
{:else}
  {@render elementContent()}
{/if}
