import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { nearestColour, type ColourName } from "./colour";

const run = promisify(execFile);

/** Room for ffprobe's packet list of a long recording. */
const ProbeBufferBytes = 64 * 1024 * 1024;

export interface ProbeResult {
  streams: { type: "video" | "audio"; codec: string }[];
  durationSec: number;
}

/**
 * The streams and duration of a media file. A WebM file from MediaRecorder
 * often has no duration in its header, so the last packet time is used then.
 */
export async function probeFile(file: string): Promise<ProbeResult> {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "stream=codec_type,codec_name:format=duration",
    "-of", "json",
    file,
  ]);
  const json = JSON.parse(stdout) as {
    streams: { codec_type: string; codec_name: string }[];
    format?: { duration?: string };
  };
  const streams = json.streams
    .filter((s) => s.codec_type === "video" || s.codec_type === "audio")
    .map((s) => ({ type: s.codec_type as "video" | "audio", codec: s.codec_name }));
  const header = Number(json.format?.duration);
  const durationSec = Number.isFinite(header) && header > 0 ? header : await lastPacketTime(file);
  return { streams, durationSec };
}

async function lastPacketTime(file: string): Promise<number> {
  const { stdout } = await run(
    "ffprobe",
    ["-v", "error", "-show_entries", "packet=pts_time", "-of", "csv=p=0", file],
    { maxBuffer: ProbeBufferBytes },
  );
  const times = stdout
    .split("\n")
    .map(Number)
    .filter((t) => Number.isFinite(t));
  return times.length > 0 ? Math.max(...times) : 0;
}

/** The colour of one frame at `atSec`, averaged to a single pixel. */
export async function frameColour(file: string, atSec: number): Promise<ColourName> {
  const { stdout } = await run(
    "ffmpeg",
    [
      "-v", "error",
      "-ss", String(atSec),
      "-i", file,
      "-frames:v", "1",
      "-vf", "scale=1:1:flags=area",
      "-f", "rawvideo", "-pix_fmt", "rgb24",
      "pipe:1",
    ],
    { encoding: "buffer" },
  );
  return nearestColour({ r: stdout[0], g: stdout[1], b: stdout[2] });
}
