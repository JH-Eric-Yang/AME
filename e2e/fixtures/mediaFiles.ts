import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The media files that global setup makes with ffmpeg, and their paths. They
 * are generated, never committed: e2e/.cache/ is in .gitignore.
 */

const Here = path.dirname(fileURLToPath(import.meta.url));

export const CacheDir = path.resolve(Here, "../.cache");

/** The ffmpeg arguments (before the output path) and the file extension of one file. */
export interface Recipe {
  ext: string;
  args: string[];
}

/** Hex characters of the recipe hash in a file name. */
const RecipeHashLength = 8;

/**
 * The cache path of a recipe. The name holds a hash of the arguments, so a
 * changed recipe gives a new file and global setup makes it again.
 */
export function recipeFile(name: string, recipe: Recipe): string {
  const hash = createHash("sha256").update(JSON.stringify(recipe.args)).digest("hex");
  return path.join(CacheDir, `${name}-${hash.slice(0, RecipeHashLength)}.${recipe.ext}`);
}

/** Solid-colour fake cameras, so a test can tell participants apart by colour. */
export const CameraColours = ["red", "green", "blue"] as const;
export type CameraColour = (typeof CameraColours)[number];

/** Fake camera size, rate and length: small, so the files stay small. */
const CameraArgs = "s=320x240:r=15:d=5";

const cameraRecipe = (colour: CameraColour): Recipe => ({
  ext: "y4m",
  args: ["-f", "lavfi", "-i", `color=c=${colour}:${CameraArgs}`, "-pix_fmt", "yuv420p"],
});

export const cameraFile = (colour: CameraColour): string => recipeFile(colour, cameraRecipe(colour));

/** Pink noise for the fake microphone: a broad spectrum, so a volume meter rises. */
const MicrophoneRecipe: Recipe = {
  ext: "wav",
  args: ["-f", "lavfi", "-i", "anoisesrc=d=5:c=pink:a=0.1", "-ar", "48000", "-ac", "1"],
};
export const MicrophoneFile = recipeFile("noise", MicrophoneRecipe);

/** A 2 s VP8/Opus clip for the video element. */
const StimulusVideoRecipe: Recipe = {
  ext: "webm",
  args: [
    "-f", "lavfi", "-i", "testsrc2=s=320x240:r=15:d=2",
    "-f", "lavfi", "-i", "sine=f=440:d=2",
    "-c:v", "libvpx", "-b:v", "200k", "-c:a", "libopus", "-shortest",
  ],
};
export const StimulusVideoFile = recipeFile("stim", StimulusVideoRecipe);

/** A 1 s tone for the audio element. */
const StimulusAudioRecipe: Recipe = {
  ext: "wav",
  args: ["-f", "lavfi", "-i", "sine=f=440:d=1", "-ar", "8000", "-ac", "1"],
};
export const StimulusAudioFile = recipeFile("tone", StimulusAudioRecipe);

/** Every file global setup makes, with its recipe. */
export const MediaRecipes: (Recipe & { file: string })[] = [
  ...CameraColours.map((colour) => ({ ...cameraRecipe(colour), file: cameraFile(colour) })),
  { ...MicrophoneRecipe, file: MicrophoneFile },
  { ...StimulusVideoRecipe, file: StimulusVideoFile },
  { ...StimulusAudioRecipe, file: StimulusAudioFile },
];

/**
 * Chromium switches for every test browser: fake media devices, the pink-noise
 * microphone, and a fake sound output. Headless Chromium has no sound device,
 * so without the fake output a playing <audio> or <video> with sound stops its clock.
 */
export const ChromiumMediaArgs = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  `--use-file-for-fake-audio-capture=${MicrophoneFile}`,
  "--disable-audio-output",
];

/** Read a file as a data URI, for a stimulus src that needs no server. */
export async function dataUri(file: string, mime: string): Promise<string> {
  const bytes = await fs.readFile(file);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}
