import { expect, type Page } from "@playwright/test";
import type { ElementType } from "ame-shared";
import { EndText } from "./kit/bench";
import { addProceedEvent, field, jsonParams, setToggle, typeInto } from "./kit/builder";
import { StimulusUrls, type TutorialSession } from "./kit/session";

const EndTextForDefinitions = EndText;

const OptionsLabel = "Options (one per line, as value|label)";

/** Paste the option lines, as a researcher does from a text editor. */
async function pasteOptions(page: Page, lines: string): Promise<void> {
  await field(page, OptionsLabel).fill(lines);
  await expect(field(page, OptionsLabel)).toHaveValue(lines);
}


/** A 4 × 4 PNG for the file picker. */
const SmallPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEklEQVR4nGP4z8DAwMDAwMAAAA0ABBXK1A8AAAAASUVORK5CYII=";

const SurveyQuestions = {
  elements: [
    { type: "text", name: "nickname", title: "What should we call you?" },
    { type: "radiogroup", name: "mood", title: "How do you feel today?", choices: ["Calm", "Tired", "Excited"] },
  ],
};

/** The phrase the speech stub "hears" (the same stub as the monitor e2e test). */
const HeardPhrase = "please continue now";

/** Replace SpeechRecognition with a stub that hears HeardPhrase 1.5 s after start. */
async function stubSpeech(page: Page): Promise<void> {
  await page.addInitScript((phrase) => {
    class FakeRecognition {
      onresult: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      lang = "";
      continuous = false;
      interimResults = false;
      start() {
        setTimeout(() => this.onresult?.({ results: [[{ transcript: phrase }]] }), 1500);
      }
      stop() {}
    }
    const w = window as unknown as Record<string, unknown>;
    w.SpeechRecognition = FakeRecognition;
    w.webkitSpeechRecognition = FakeRecognition;
  }, HeardPhrase);
}

/**
 * What each tutorial does with its element. The common steps (sign in, drag,
 * select, save, start, Next, Results) are in elements.tutorial.ts.
 */
export interface TutorialDefinition {
  type: ElementType;
  /** The palette group: Stimulus, Response or Monitor. */
  paletteGroup: "Stimulus" | "Response" | "Monitor";
  /** One or two sentences for the top of the page. */
  summary: string;
  /** The question text above the element. It must be unique on the page. */
  question: string;
  /** Inspector steps after the element is selected. */
  build: (t: TutorialSession, name: string) => Promise<void>;
  /** Participant steps after the first routine shows. */
  run: (t: TutorialSession) => Promise<void>;
  /** The element proceeds by itself, so the participant does not click Next. */
  autoProceeds?: boolean;
  /** Assertions on the stored response of the trial routine. */
  expectStored: (stored: Record<string, unknown>, name: string) => void;
  /** Text that the Results row must show. */
  resultText?: (name: string) => string;
  resultDetail?: string;
  checks: string[];
  /** The params this tutorial sets, and the value it sets. */
  params?: { key: string; value: string }[];
  defects?: string[];
  notes?: string[];
  /** Run before the first page loads (for example a browser stub). */
  prepare?: (page: Page) => Promise<void>;
}

export const Tutorials: TutorialDefinition[] = [
  {
    type: "text",
    paletteGroup: "Stimulus",
    summary: "Text shows words on the screen. You can set the size, the weight and the alignment, and you can make the text appear late or leave early.",
    question: "Read the instruction below.",
    build: async (t, name) => {
      await t.step("Build", "Type the instruction in the Content field.", async () => {
        await typeInto(field(t.page, "Content"), "Look at the cross in the centre of the screen.");
      });
      await t.step("Build", "Set Size to 28 and Weight to Semibold.", async () => {
        await field(t.page, "Size").fill("28");
        await field(t.page, "Weight").selectOption({ label: "Semibold" });
        await expect(t.page.getByRole("button", { name, exact: true })).toContainText("Look at the cross");
      });
    },
    run: async (t) => {
      await t.step("Run", "Read the instruction.", async () => {
        await expect(t.page.getByText("Look at the cross in the centre of the screen.")).toBeVisible();
      }, { detail: "Text records no answer. The routine stores only the Next click." });
    },
    expectStored: (stored) => expect(stored).toMatchObject({ next: true }),
    resultText: () => '"next":true',
    resultDetail: "Text records no data. The row shows the Next click only.",
    checks: ["The participant sees the instruction in the size and weight that you set.", "The routine stores the Next click."],
    params: [
      { key: "content", value: "Look at the cross in the centre of the screen." },
      { key: "fontSize", value: "28px" },
      { key: "fontWeight", value: "600" },
    ],
  },
  {
    type: "image",
    paletteGroup: "Stimulus",
    summary: "Image shows a picture. The picture can come from the Media library, from an earlier recording, or from a web address.",
    question: "Look at the picture below.",
    build: async (t) => {
      await t.step("Build", "Paste the picture's web address in the Source field.", async () => {
        await typeInto(field(t.page, "or paste a URL"), StimulusUrls.picture);
      }, { detail: "To use a file from your computer, upload it on the Media tab, then click Choose from library." });
      await t.step("Build", "Type a short description in Alt text.", async () => {
        await typeInto(field(t.page, "Alt text"), "A red circle and a black square");
      }, { detail: "A screen reader reads the alt text to a participant who cannot see the picture." });
    },
    run: async (t) => {
      await t.step("Run", "Look at the picture.", async () => {
        const img = t.page.getByAltText("A red circle and a black square");
        await expect(img).toBeVisible();
        await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
      });
    },
    expectStored: (stored) => expect(stored).toMatchObject({ next: true }),
    resultDetail: "Image records no data. The row shows the Next click only.",
    checks: ["The picture loads from its address.", "The alt text is on the picture."],
    params: [
      { key: "src", value: StimulusUrls.picture },
      { key: "alt", value: "A red circle and a black square" },
    ],
  },
  {
    type: "video",
    paletteGroup: "Stimulus",
    summary: "Video plays a clip. You choose if it starts by itself, if it plays again at the end, if it has sound, and if the participant gets the play controls.",
    question: "Watch the clip below.",
    build: async (t) => {
      await t.step("Build", "Paste the clip's web address in the Source field.", async () => {
        await typeInto(field(t.page, "or paste a URL"), StimulusUrls.clip);
      }, { detail: "To use a file from your computer, upload it on the Media tab, then click Choose from library." });
      await t.step("Build", "Turn on Autoplay, Loop and Muted. Turn off Show controls.", async () => {
        await setToggle(t.page, "Autoplay", true);
        await setToggle(t.page, "Loop", true);
        await setToggle(t.page, "Muted", true);
        await setToggle(t.page, "Show controls", false);
      }, { caution: "A browser can stop a clip with sound from starting by itself. Keep Muted on, or keep Show controls on." });
    },
    run: async (t) => {
      await t.step("Run", "Watch the clip. It starts by itself.", async () => {
        const clip = t.page.locator("video");
        await expect
          .poll(() => clip.evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0.5), { timeout: 10_000 })
          .toBe(true);
      });
    },
    expectStored: (stored) => expect(stored).toMatchObject({ next: true }),
    resultDetail: "Video records no data. The row shows the Next click only.",
    checks: ["The clip starts by itself and plays.", "The participant gets no play controls."],
    params: [
      { key: "src", value: StimulusUrls.clip },
      { key: "autoplay", value: "true" },
      { key: "loop", value: "true" },
      { key: "muted", value: "true" },
      { key: "controls", value: "false" },
    ],
  },
  {
    type: "audio",
    paletteGroup: "Stimulus",
    summary: "Audio plays a sound. You choose if it starts by itself, if it plays again at the end, and if the participant gets the play controls.",
    question: "Listen to the sound.",
    build: async (t) => {
      await t.step("Build", "Paste the sound's web address in the Source field.", async () => {
        await typeInto(field(t.page, "or paste a URL"), StimulusUrls.tone);
      });
      await t.step("Build", "Turn on Autoplay and Loop. Keep Show controls on.", async () => {
        await setToggle(t.page, "Autoplay", true);
        await setToggle(t.page, "Loop", true);
        await setToggle(t.page, "Show controls", true);
      });
    },
    run: async (t) => {
      await t.step("Run", "Listen to the sound. It starts by itself.", async () => {
        const tone = t.page.locator("audio");
        await expect
          .poll(() => tone.evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > 0.2), { timeout: 10_000 })
          .toBe(true);
      }, { detail: "The participant clicked Begin Experiment, so the browser lets the sound start." });
    },
    expectStored: (stored) => expect(stored).toMatchObject({ next: true }),
    resultDetail: "Audio records no data. The row shows the Next click only.",
    checks: ["The sound starts by itself after the participant's first click.", "The play controls show."],
    params: [
      { key: "src", value: StimulusUrls.tone },
      { key: "autoplay", value: "true" },
      { key: "loop", value: "true" },
      { key: "controls", value: "true" },
    ],
  },
  {
    type: "button",
    paletteGroup: "Response",
    summary: "Button records a value when the participant clicks it. With a click event, the click also ends the routine.",
    question: "Do you agree to take part?",
    autoProceeds: true,
    build: async (t) => {
      await t.step("Build", "Type I agree in the Label field.", async () => {
        await typeInto(field(t.page, "Label"), "I agree");
      });
      await t.step("Build", "Type agree in the Value field.", async () => {
        await typeInto(field(t.page, "Value (stored on interaction)"), "agree");
      }, { detail: "The value goes into your data. The label is the text the participant sees." });
      await t.step("Build", "Click + Add Event. Keep click → proceed.", async () => {
        await addProceedEvent(t.page);
      }, { detail: "A click on the button then ends the routine, as Next does." });
    },
    run: async (t) => {
      await t.step("Run", "Click I agree.", async () => {
        await t.page.getByRole("button", { name: "I agree" }).click();
      }, { detail: "The click records the value and ends the routine." });
    },
    expectStored: (stored, name) => expect(stored).toMatchObject({ [name]: "agree" }),
    resultText: (name) => `"${name}":"agree"`,
    resultDetail: "The Response column shows the button's value under the button's name.",
    checks: ["The click records the value agree.", "The click event ends the routine."],
    params: [
      { key: "label", value: "I agree" },
      { key: "value", value: "agree" },
    ],
  },
  {
    type: "input-textfield",
    paletteGroup: "Response",
    summary: "Text Field records what the participant types. A placeholder can show an example of the answer.",
    question: "How old are you?",
    build: async (t) => {
      await t.step("Build", "Type Your age in years in the Placeholder field.", async () => {
        await typeInto(field(t.page, "Placeholder"), "Your age in years");
      }, { detail: "The placeholder shows in the empty field. It is not an answer." });
    },
    run: async (t) => {
      await t.step("Run", "Type 34 in the field.", async () => {
        await typeInto(t.page.getByPlaceholder("Your age in years"), "34");
      });
    },
    expectStored: (stored, name) => expect(stored).toMatchObject({ [name]: "34" }),
    resultText: (name) => `"${name}":"34"`,
    resultDetail: "The Response column shows the typed text under the field's name.",
    checks: ["The typed text is stored as text."],
    params: [{ key: "placeholder", value: "Your age in years" }],
  },
  {
    type: "input-select",
    paletteGroup: "Response",
    summary: "Select gives the participant a list to choose one answer from. You give the options, one on each line.",
    question: "Which language do you speak at home?",
    build: async (t) => {
      await t.step("Build", "Paste the options, one on each line, as value|label.", async () => {
        await pasteOptions(t.page, "en|English\nja|Japanese\nde|German");
      }, { detail: "The value goes into your data. The label is the text the participant sees." });
    },
    run: async (t) => {
      await t.step("Run", "Select Japanese.", async () => {
        await t.page.getByRole("combobox").selectOption({ label: "Japanese" });
      });
    },
    expectStored: (stored, name) => expect(stored).toMatchObject({ [name]: "ja" }),
    resultText: (name) => `"${name}":"ja"`,
    resultDetail: "The Response column shows the value ja, not the label Japanese.",
    checks: ["The value of the selected option is stored."],
    params: [{ key: "options", value: "en|English, ja|Japanese, de|German" }],
  },
  {
    type: "input-slider",
    paletteGroup: "Response",
    summary: "Slider records a number on a scale. The participant moves a handle, and AME records the number at the handle.",
    question: "How much did you enjoy the clip?",
    build: async (t) => {
      await t.step("Build", "Set Min to 0 and Max to 10.", async () => {
        await field(t.page, "Min").fill("0");
        await field(t.page, "Max").fill("10");
      }, { detail: "Step sets the distance between two values. Keep 1." });
      await t.step("Build", "Set Default value to 5.", async () => {
        await field(t.page, "Default value").fill("5");
      }, { caution: "A default value counts as an answer. If the participant does not move the handle, AME records 5." });
      await t.step("Build", "Type the two end labels.", async () => {
        await typeInto(field(t.page, "Left label"), "Not at all");
        await typeInto(field(t.page, "Right label"), "Very much");
      });
    },
    run: async (t) => {
      await t.step("Run", "Move the slider to 8.", async () => {
        const slider = t.page.getByRole("slider");
        await slider.focus();
        for (let i = 0; i < 3; i++) await t.page.keyboard.press("ArrowRight");
        await expect(slider).toHaveValue("8");
      }, { detail: "The participant can drag the handle or use the arrow keys." });
    },
    expectStored: (stored, name) => expect(stored).toMatchObject({ [name]: 8 }),
    resultText: (name) => `"${name}":8`,
    resultDetail: "The Response column shows the number under the slider's name.",
    checks: ["The slider starts at 5.", "The value is stored as a number."],
    params: [
      { key: "min", value: "0" },
      { key: "max", value: "10" },
      { key: "defaultValue", value: "5" },
      { key: "leftLabel", value: "Not at all" },
      { key: "rightLabel", value: "Very much" },
    ],
  },
  {
    type: "input-option-group",
    paletteGroup: "Response",
    summary: "Options shows a set of choices as radio buttons, check boxes or toggle buttons. Radio buttons accept one answer.",
    question: "Which colour do you like most?",
    build: async (t) => {
      await t.step("Build", "Set Control Type to Radio (single).", async () => {
        await field(t.page, "Control Type").selectOption({ label: "Radio (single)" });
      });
      await t.step("Build", "Paste the options, one on each line, as value|label.", async () => {
        await pasteOptions(t.page, "red|Red\nblue|Blue\ngreen|Green");
      });
    },
    run: async (t) => {
      await t.step("Run", "Click Blue.", async () => {
        await t.page.getByRole("radio", { name: "Blue" }).check();
      });
    },
    expectStored: (stored, name) => expect(stored).toMatchObject({ [name]: "blue" }),
    resultText: (name) => `"${name}":"blue"`,
    resultDetail: "The Response column shows the value of the chosen option.",
    checks: ["One radio button can be on at a time.", "The value of the chosen option is stored."],
    params: [
      { key: "optionType", value: "radio" },
      { key: "options", value: "red|Red, blue|Blue, green|Green" },
    ],
  },
  {
    type: "input-file-picker",
    paletteGroup: "Response",
    summary: "File Picker lets the participant send a file. The file uploads at once, and Next waits until the upload is complete.",
    question: "Send a photo of your workspace.",
    build: async (t) => {
      await t.step("Build", "Type image/* in Accepted Types.", async () => {
        await typeInto(field(t.page, "Accepted Types (e.g. image/*,.pdf)"), "image/*");
      }, { detail: "image/* accepts every picture file. Separate more types with commas, for example image/*,.pdf." });
      await t.step("Build", "Type Choose a photo in Button Label.", async () => {
        await typeInto(field(t.page, "Button Label"), "Choose a photo");
      });
    },
    run: async (t) => {
      await t.step("Run", "Click Choose a photo, and select a file.", async () => {
        await t.page.locator('input[type="file"]').setInputFiles({
          name: "workspace.png",
          mimeType: "image/png",
          buffer: Buffer.from(SmallPng, "base64"),
        });
        await expect(t.page.getByText("workspace.png")).toBeVisible();
        await expect(t.page.getByText("Uploaded")).toBeVisible({ timeout: 15_000 });
      }, { detail: "The browser's file window does not show in the video. The file uploads when the participant selects it." });
    },
    expectStored: (stored, name) => expect(stored).toMatchObject({ [name]: [{ name: "workspace.png", mimeType: "image/png" }] }),
    resultDetail: "The Response column shows the file name. Export Files (ZIP) gives you the files.",
    checks: ["The file uploads before the routine ends.", "The response stores the file name and type."],
    params: [
      { key: "accept", value: "image/*" },
      { key: "label", value: "Choose a photo" },
    ],
  },
  {
    type: "keyboard",
    paletteGroup: "Response",
    summary: "Keyboard records a key press and its reaction time. You can accept only some keys, for example F and J.",
    question: "Is the word a colour? Press F for yes, J for no.",
    build: async (t) => {
      await t.step("Build", "Type f,j in Accepted Keys.", async () => {
        await typeInto(field(t.page, "Accepted Keys (comma-separated, blank = any)"), "f,j");
      }, { detail: "AME ignores all other keys." });
      await t.step("Build", "Type a hint for the participant.", async () => {
        await typeInto(field(t.page, "Hint (blank = invisible)"), "Press F or J");
      });
    },
    run: async (t) => {
      await t.step("Run", "Press J.", async () => {
        await expect(t.page.getByText("Press F or J")).toBeVisible();
        await t.page.keyboard.press("j");
      }, { detail: "AME records the key and the time from the start of the routine (rt, in ms)." });
    },
    expectStored: (stored, name) => expect(stored).toMatchObject({ [name]: { key: "j" } }),
    resultText: () => '"key":"j"',
    resultDetail: "The Response column shows the key, the key code, the time and the reaction time.",
    checks: ["The J key is recorded.", "The record has a reaction time (rt)."],
    params: [
      { key: "keys", value: "f,j" },
      { key: "hint", value: "Press F or J" },
    ],
  },
  {
    type: "survey",
    paletteGroup: "Response",
    summary: "Survey shows a SurveyJS questionnaire. You paste the questions as JSON, and each answer is stored under its question name.",
    question: "Answer two short questions.",
    autoProceeds: true,
    build: async (t) => {
      await t.step("Build", "Paste the survey JSON in the Survey JSON field.", async () => {
        await field(t.page, "Survey JSON").fill(JSON.stringify(SurveyQuestions, null, 2));
      }, { detail: "You can make the JSON with the SurveyJS Creator, then copy it here." });
      await t.step("Build", "Type Send answers in Submit Label. Turn on Proceed on complete.", async () => {
        await typeInto(field(t.page, "Submit Label"), "Send answers");
        await setToggle(t.page, "Proceed on complete", true);
      }, { detail: "The routine then ends when the participant sends the answers." });
    },
    run: async (t) => {
      await t.step("Run", "Type a name, and select Calm.", async () => {
        await typeInto(t.page.getByRole("textbox").first(), "Robin");
        await t.page.getByText("Calm", { exact: true }).click();
      });
      await t.step("Run", "Click Send answers.", async () => {
        await t.page.getByRole("button", { name: "Send answers" }).click();
      });
    },
    expectStored: (stored) => expect(stored).toMatchObject({ nickname: "Robin", mood: "Calm" }),
    resultText: () => '"nickname":"Robin"',
    resultDetail: "Each answer is stored under its question name, for example nickname and mood.",
    checks: ["Each answer is stored under its question name.", "Send answers ends the routine."],
    params: [
      { key: "surveyJson", value: "2 questions" },
      { key: "submitLabel", value: "Send answers" },
      { key: "proceedOnComplete", value: "true" },
    ],
  },
  {
    type: "timer",
    paletteGroup: "Monitor",
    summary: "Timer counts down. With a timeout event, the routine ends when the time is over, and the participant does not click.",
    question: "Look at the screen until the time is over.",
    autoProceeds: true,
    build: async (t) => {
      await t.step("Build", "Type 5 in the Duration (s) field. Set Format to Seconds.", async () => {
        await field(t.page, "Duration (s)").fill("5");
        await field(t.page, "Format").selectOption({ label: "Seconds" });
      });
      await t.step("Build", "Click + Add Event. Keep timeout → proceed.", async () => {
        await addProceedEvent(t.page);
      });
    },
    run: async (t) => {
      await t.step("Run", "Wait. The timer counts down, then the study continues.", async () => {
        // The countdown started with the routine, so it can be below 5 s already.
        await expect(t.page.getByText(/^[1-5]s$/)).toBeVisible();
        await expect(t.page.getByText(EndTextForDefinitions)).toBeVisible({ timeout: 10_000 });
      });
    },
    expectStored: (stored) => expect(stored).toBeDefined(),
    resultDetail: "Timer records no answer. The row shows that the routine ended.",
    checks: ["The countdown shows in seconds.", "The timeout ends the routine without a click."],
    params: [
      { key: "duration", value: "5" },
      { key: "format", value: "seconds" },
    ],
  },
  {
    type: "volume-check",
    paletteGroup: "Monitor",
    summary: "Vol. Check listens to the microphone. When the sound level reaches the threshold, it records the level and can end the routine.",
    question: "Say your name aloud.",
    autoProceeds: true,
    build: async (t) => {
      await t.step("Build", "Type the threshold in the params JSON.", async () => {
        await jsonParams(t.page).fill('{ "threshold": 5 }');
      }, { detail: "The level goes from 0 to 255. A quiet room is near 5; normal speech is 20 to 60." });
      await t.step("Build", "Click + Add Event. Keep detection → proceed.", async () => {
        await addProceedEvent(t.page);
      });
    },
    run: async (t) => {
      await t.step("Run", "Speak. The check passes, and the study continues.", async () => {
        await expect(t.page.getByText(EndTextForDefinitions)).toBeVisible({ timeout: 15_000 });
      }, { detail: "The browser asks for the microphone first. The test browser uses a recorded noise as its microphone." });
    },
    expectStored: (stored, name) => expect(stored).toMatchObject({ [name]: { passed: true } }),
    resultText: (name) => `"${name}":{"level"`,
    resultDetail: "The Response column shows the level that passed the check.",
    checks: ["The microphone noise passes the threshold.", "The detection event ends the routine.", "The level is stored with passed true."],
    params: [{ key: "threshold", value: "5" }],
  },
  {
    type: "speech-recognizer",
    paletteGroup: "Monitor",
    summary: "Speech Rec. turns the participant's speech into text. When it hears a keyword, it records the transcript and can end the routine.",
    question: "Say: please continue now.",
    autoProceeds: true,
    prepare: stubSpeech,
    build: async (t) => {
      await t.step("Build", "Type the keywords in the params JSON.", async () => {
        await jsonParams(t.page).fill('{ "keywords": ["continue"] }');
      }, { detail: "A keyword matches anywhere in the transcript, in upper or lower case." });
      await t.step("Build", "Click + Add Event. Keep keyword → proceed.", async () => {
        await addProceedEvent(t.page);
      });
    },
    run: async (t) => {
      await t.step("Run", "Say the sentence. The keyword ends the routine.", async () => {
        await expect(t.page.getByText(EndTextForDefinitions)).toBeVisible({ timeout: 15_000 });
      });
    },
    expectStored: (stored, name) => expect(stored).toMatchObject({ [name]: { keyword: "continue", transcript: HeardPhrase } }),
    resultText: (name) => `"${name}":{"keyword":"continue"`,
    resultDetail: "The Response column shows the keyword and the transcript.",
    checks: ["The keyword continue is found in the transcript.", "The keyword event ends the routine."],
    params: [{ key: "keywords", value: '["continue"]' }],
    notes: ["The tutorial browser simulates the speech, because real recognition sends the sound to a Google service. Test real speech by hand."],
  },
];
