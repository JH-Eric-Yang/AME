import type { ElementConfig, EventTrigger } from "ame-shared";

export interface DeviceIntent {
  elementName: string;
  trigger: EventTrigger;
  value: unknown;
  progress: number;
}

/**
 * The element a phone's press refers to, or null when the press must be
 * dropped.
 *
 * A phone sleeps, reconnects and re-sends. A press carrying a progress other
 * than the one the desktop is on belongs to a routine the participant has
 * already left: applying it would record an answer against the wrong trial, or
 * proceed a routine twice.
 */
export function resolveDeviceIntent(
  intent: DeviceIntent,
  deviceElements: ElementConfig[],
  currentProgress: number,
): ElementConfig | null {
  if (intent.progress !== currentProgress) return null;
  return deviceElements.find((el) => el.name === intent.elementName) ?? null;
}
