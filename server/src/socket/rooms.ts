/**
 * The room only a participant's phone joins. Their desktop is in
 * `experiment:<experimentId>:<participantId>` and NOT in this one, so a device
 * payload never reaches the desktop socket and the desktop needs no branch to
 * ignore it.
 *
 * Lives in its own module (not `signalingHandler.ts`, where it started) because
 * `progressHandler.ts` needs it to address the device room, and
 * `signalingHandler.ts` in turn needs `progressHandler`'s `sendDeviceContent` to
 * catch a phone up on connect — two modules importing each other's runtime
 * exports. Both usages are inside function bodies, which Node's ESM would
 * likely resolve fine even as a cycle, but there is no reason to rely on that
 * when a shared leaf module removes the cycle entirely.
 */
export function deviceRoom(experimentId: string, participantId: string): string {
  return `device:${experimentId}:${participantId}`;
}

/** The room a participant's desktop (and, for signalling, their phone) joins. */
export function participantRoom(experimentId: string, participantId: string): string {
  return `experiment:${experimentId}:${participantId}`;
}
