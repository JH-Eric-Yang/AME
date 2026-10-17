/**
 * When an audio element must show its own Play button. A browser can refuse
 * autoplay with sound (NotAllowedError); with Show controls off the
 * participant then has no way to start the sound (E2E-D4).
 */

export interface PlaybackState {
  autoplay: boolean;
  controls: boolean;
  /** play() was refused by the browser's autoplay policy. */
  blocked: boolean;
}

export function needsPlayButton(s: PlaybackState): boolean {
  return s.autoplay && s.blocked && !s.controls;
}

/** True only for the autoplay refusal, not for a source that fails to load. */
export function isAutoplayBlock(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotAllowedError";
}
