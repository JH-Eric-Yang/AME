import type { RoutineConfig } from "ame-shared";
import { card, createBench, deleteBench, endRoutine, marker, nextButton } from "./common";

export const MonitorBenchName = "E2E — Monitor Bench";

export const MonitorMarkers = {
  timer: "Timer bench",
  strictVolume: "Strict volume bench",
  volume: "Volume bench",
  speech: "Speech bench",
  done: "Monitor bench done",
} as const;

/** Seconds the timer counts down. */
export const TimerSeconds = 2;
/** The fake microphone's pink noise passes this level easily. */
export const LowThreshold = 5;
/** A level the noise cannot reach: every frequency bin would have to be near full scale. */
export const UnreachableThreshold = 250;
export const Keyword = "continue";

export async function seedMonitorBench(): Promise<string> {
  const routines: RoutineConfig[] = [
    card("timer-trial", [
      marker(MonitorMarkers.timer),
      {
        name: "countdown",
        type: "timer",
        params: { duration: TimerSeconds, format: "seconds" },
        events: [{ trigger: "timeout", type: "proceed" }],
      },
    ]),
    card("strict-volume-trial", [
      marker(MonitorMarkers.strictVolume),
      { name: "strict-mic", type: "volume-check", params: { threshold: UnreachableThreshold } },
      nextButton(),
    ]),
    card("volume-trial", [
      marker(MonitorMarkers.volume),
      {
        name: "mic",
        type: "volume-check",
        params: { threshold: LowThreshold },
        events: [{ trigger: "detection", type: "proceed" }],
      },
    ]),
    card("speech-trial", [
      marker(MonitorMarkers.speech),
      {
        name: "speech",
        type: "speech-recognizer",
        params: { keywords: [Keyword] },
        events: [{ trigger: "keyword", type: "proceed" }],
      },
    ]),
    endRoutine(MonitorMarkers.done),
  ];
  return createBench(MonitorBenchName, routines);
}

export const deleteMonitorBench = () => deleteBench(MonitorBenchName);
