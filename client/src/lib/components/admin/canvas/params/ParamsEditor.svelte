<script lang="ts">
  import type {
    ElementConfig, ElementParams, TextParams, ButtonParams, TimerParams, InputSliderParams,
    ImageParams, VideoParams, InputTextfieldParams, InputSelectParams, BodyDetectorParams, KeyboardParams,
    InputOptionGroupParams, InputFilePickerParams, SurveyParams, FacialExpressionDetectorParams, VideoChatParams,
  } from "ame-shared";
  import TextParamsEditor from "./TextParamsEditor.svelte";
  import ButtonParamsEditor from "./ButtonParamsEditor.svelte";
  import TimerParamsEditor from "./TimerParamsEditor.svelte";
  import SliderParamsEditor from "./SliderParamsEditor.svelte";
  import ImageParamsEditor from "./ImageParamsEditor.svelte";
  import MediaParamsEditor from "./MediaParamsEditor.svelte";
  import TextfieldParamsEditor from "./TextfieldParamsEditor.svelte";
  import SelectParamsEditor from "./SelectParamsEditor.svelte";
  import BodyDetectorParamsEditor from "./BodyDetectorParamsEditor.svelte";
  import KeyboardParamsEditor from "./KeyboardParamsEditor.svelte";
  import OptionGroupParamsEditor from "./OptionGroupParamsEditor.svelte";
  import FilePickerParamsEditor from "./FilePickerParamsEditor.svelte";
  import SurveyParamsEditor from "./SurveyParamsEditor.svelte";
  import FacialExpressionParamsEditor from "./FacialExpressionParamsEditor.svelte";
  import VideoChatParamsEditor from "./VideoChatParamsEditor.svelte";
  import JsonParamsEditor from "./JsonParamsEditor.svelte";

  interface Props {
    element: ElementConfig;
    /** Free layout hides fields the box overrides (image width/height). */
    freeMode: boolean;
    /** For the media source pickers. */
    experimentId: string;
    onchange: (params: ElementParams) => void;
  }

  let { element, freeMode, experimentId, onchange }: Props = $props();

  /**
   * The one merge. Editors send a partial patch and never see the whole
   * params object, so no editor can drop a key it does not know about. A
   * patch value of `undefined` clears a key — JSON serialisation drops it,
   * which the runtime's `??` defaults rely on.
   */
  function patch(p: object) {
    onchange({ ...element.params, ...p } as ElementParams);
  }
</script>

{#if element.type === "text"}
  <TextParamsEditor params={element.params as TextParams} onchange={patch} />
{:else if element.type === "button"}
  <ButtonParamsEditor params={element.params as ButtonParams} onchange={patch} />
{:else if element.type === "timer"}
  <TimerParamsEditor params={element.params as TimerParams} onchange={patch} />
{:else if element.type === "input-slider"}
  <SliderParamsEditor params={element.params as InputSliderParams} onchange={patch} />
{:else if element.type === "image"}
  <ImageParamsEditor params={element.params as ImageParams} {experimentId} {freeMode} onchange={patch} />
{:else if element.type === "video" || element.type === "audio"}
  <MediaParamsEditor params={element.params as VideoParams} accept={element.type} {experimentId} onchange={patch} />
{:else if element.type === "input-textfield"}
  <TextfieldParamsEditor params={element.params as InputTextfieldParams} onchange={patch} />
{:else if element.type === "input-select"}
  <SelectParamsEditor params={element.params as InputSelectParams} onchange={patch} />
{:else if element.type === "body-detector"}
  <BodyDetectorParamsEditor params={element.params as BodyDetectorParams} onchange={patch} />
{:else if element.type === "keyboard"}
  <KeyboardParamsEditor params={element.params as KeyboardParams} onchange={patch} />
{:else if element.type === "input-option-group"}
  <OptionGroupParamsEditor params={element.params as InputOptionGroupParams} onchange={patch} />
{:else if element.type === "input-file-picker"}
  <FilePickerParamsEditor params={element.params as InputFilePickerParams} onchange={patch} />
{:else if element.type === "survey"}
  <SurveyParamsEditor params={element.params as SurveyParams} onchange={patch} />
{:else if element.type === "facial-expression-detector"}
  <FacialExpressionParamsEditor params={element.params as FacialExpressionDetectorParams} onchange={patch} />
{:else if element.type === "video-chat"}
  <VideoChatParamsEditor params={element.params as VideoChatParams} onchange={patch} />
{:else}
  <JsonParamsEditor params={element.params} onchange={onchange} />
{/if}
