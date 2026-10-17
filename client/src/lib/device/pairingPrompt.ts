import type { DeviceConfig } from "ame-shared";

/**
 * Whether the desktop should show the participant how to pair their phone.
 *
 * Only a routine that actually declares `mode: "controller"` has anything on
 * the phone worth pairing for — a routine with no `device` config, or one
 * using `mode: "camera"` (multi-capture handles its own pairing UI), must
 * never prompt. Once a controller has connected, the prompt is redundant.
 */
export function shouldPromptForPairing(
  device: DeviceConfig | null | undefined,
  deviceConnected: boolean,
): boolean {
  if (!device || device.mode !== "controller") return false;
  return !deviceConnected;
}

/**
 * The URL the phone must open to pair as this routine's controller. Mirrors
 * the pattern `ElMultiCapture` uses for its own (camera-mode) QR code, with
 * `mode=controller` instead of an `element` name — a controller pairing has
 * no single element to target.
 */
export function buildControllerPairingUrl(
  origin: string,
  experimentId: string,
  participantId: string,
): string {
  return `${origin}/device/${experimentId}/${participantId}?mode=controller`;
}
