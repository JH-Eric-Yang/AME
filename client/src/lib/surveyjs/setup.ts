import * as SurveyCore from "survey-core";
import { Model } from "survey-core";
import { renderSurvey, unmountComponentAtNode } from "survey-js-ui";
import "survey-core/survey-core.min.css";
import * as widgets from "surveyjs-widgets";
import "nouislider/dist/nouislider.css";
import "./theme.css";

let initialized = false;

export function initSurveyJS(): void {
  if (initialized) return;
  // surveyjs-widgets registers against the survey-core namespace
  // (Survey.ElementFactory, Survey.CustomWidgetCollection), not the Model class.
  widgets.nouislider(SurveyCore);
  initialized = true;
}

export function createSurveyModel(json: Record<string, unknown>): Model {
  initSurveyJS();
  return new Model(json);
}

export { renderSurvey, unmountComponentAtNode };

export interface MountSurveyOptions {
  showProgressBar?: "off" | "top" | "bottom";
  submitLabel?: string;
  /** Called with the survey's answers when the participant submits. */
  onComplete: (data: Record<string, unknown>) => void;
}

/**
 * Build, configure and render a SurveyJS model into `container`.
 * Shared by routine-survey and element-survey.
 *
 * @returns a dispose function that tears the survey down
 */
export function mountSurvey(
  container: HTMLElement,
  json: Record<string, unknown>,
  options: MountSurveyOptions,
): () => void {
  const model = createSurveyModel(json);

  if (options.showProgressBar && options.showProgressBar !== "off") {
    model.showProgressBar = options.showProgressBar;
    model.progressBarType = "pages";
  }
  if (options.submitLabel) {
    model.completeText = options.submitLabel;
  }

  // AME owns the post-submit screen, so suppress SurveyJS's own.
  model.showCompletedPage = false;
  model.onComplete.add((sender) => {
    options.onComplete(sender.data as Record<string, unknown>);
  });

  renderSurvey(model, container);

  return () => {
    model.dispose();
    unmountComponentAtNode(container);
  };
}
