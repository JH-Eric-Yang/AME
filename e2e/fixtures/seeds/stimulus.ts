import type { RoutineConfig } from "ame-shared";
import { dataUri, StimulusAudioFile, StimulusVideoFile } from "../mediaFiles";
import { card, createBench, deleteBench, endRoutine, marker, nextButton } from "./common";

export const StimulusBenchName = "E2E — Stimulus Bench";

/** Each routine's marker, in order. */
export const StimulusMarkers = {
  text: "Text bench",
  image: "Image bench",
  video: "Video bench",
  audio: "Audio bench",
  done: "Stimulus bench done",
} as const;

export const TimedWords = "Timed words";
/** Milliseconds from routine start until the timed text appears. */
export const TimedOnsetMs = 1500;
/** Milliseconds the timed text stays after it appears. */
export const TimedDurationMs = 1500;

export const BenchPictureAlt = "Bench picture";
const BenchPicture =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#333"/></svg>`,
  );

export async function seedStimulusBench(): Promise<string> {
  const routines: RoutineConfig[] = [
    card("text-trial", [
      marker(StimulusMarkers.text),
      {
        name: "timed",
        type: "text",
        params: { content: TimedWords },
        onsetTime: TimedOnsetMs,
        duration: TimedDurationMs,
      },
      nextButton(),
    ]),
    card("image-trial", [
      marker(StimulusMarkers.image),
      { name: "picture", type: "image", params: { src: BenchPicture, alt: BenchPictureAlt } },
      nextButton(),
    ]),
    card("video-trial", [
      marker(StimulusMarkers.video),
      {
        name: "autoplay-clip",
        type: "video",
        params: {
          src: await dataUri(StimulusVideoFile, "video/webm"),
          autoplay: true,
          muted: true,
          loop: true,
          controls: false,
        },
      },
      {
        name: "controls-clip",
        type: "video",
        params: { src: await dataUri(StimulusVideoFile, "video/webm"), controls: true },
      },
      nextButton(),
    ]),
    card("audio-trial", [
      marker(StimulusMarkers.audio),
      {
        name: "tone",
        type: "audio",
        params: {
          src: await dataUri(StimulusAudioFile, "audio/wav"),
          autoplay: true,
          loop: true,
          controls: false,
        },
      },
      nextButton(),
    ]),
    endRoutine(StimulusMarkers.done),
  ];
  return createBench(StimulusBenchName, routines);
}

export const deleteStimulusBench = () => deleteBench(StimulusBenchName);
