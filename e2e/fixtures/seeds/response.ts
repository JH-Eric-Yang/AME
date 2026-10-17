import type { RoutineConfig } from "ame-shared";
import { card, createBench, deleteBench, endRoutine, marker, nextButton } from "./common";

export const ResponseBenchName = "E2E — Response Bench";

export const ResponseMarkers = {
  button: "Button bench",
  textfield: "Textfield bench",
  textDefault: "Default text bench",
  sliderKeys: "Slider keys bench",
  sliderDrag: "Slider drag bench",
  defaults: "Defaults bench",
  done: "Response bench done",
} as const;

export const SliderDefault = 5;
export const SliderMax = 10;
export const CityDefault = "Coventry";

export async function seedResponseBench(): Promise<string> {
  const routines: RoutineConfig[] = [
    card("button-trial", [
      marker(ResponseMarkers.button),
      {
        name: "agree",
        type: "button",
        params: { label: "Agree", value: "yes" },
        events: [{ trigger: "click", type: "proceed" }],
      },
    ]),
    card("textfield-trial", [
      marker(ResponseMarkers.textfield),
      { name: "nickname", type: "input-textfield", params: { placeholder: "Your nickname" } },
      nextButton(),
    ]),
    card("textfield-default-trial", [
      marker(ResponseMarkers.textDefault),
      { name: "city", type: "input-textfield", params: { defaultValue: CityDefault } },
      nextButton(),
    ]),
    card("slider-keys-trial", [
      marker(ResponseMarkers.sliderKeys),
      {
        name: "rating",
        type: "input-slider",
        params: { min: 0, max: SliderMax, step: 1, defaultValue: SliderDefault },
      },
      nextButton(),
    ]),
    card("slider-drag-trial", [
      marker(ResponseMarkers.sliderDrag),
      { name: "intensity", type: "input-slider", params: { min: 0, max: SliderMax, step: 1 } },
      nextButton(),
    ]),
    card("defaults-trial", [
      marker(ResponseMarkers.defaults),
      {
        name: "language",
        type: "input-select",
        params: {
          options: [
            { value: "en", label: "English" },
            { value: "ja", label: "Japanese" },
          ],
          defaultValue: "ja",
        },
      },
      {
        name: "colour",
        type: "input-option-group",
        params: {
          optionType: "radio",
          options: [
            { value: "red", label: "Red" },
            { value: "blue", label: "Blue" },
          ],
          defaultValue: "blue",
        },
      },
      nextButton(),
    ]),
    endRoutine(ResponseMarkers.done),
  ];
  return createBench(ResponseBenchName, routines);
}

export const deleteResponseBench = () => deleteBench(ResponseBenchName);
