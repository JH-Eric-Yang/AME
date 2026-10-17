/**
 * Peer selection for the video-chat mesh.
 *
 * The server ships two peer lists. `match:matched` delivers the whole matched
 * cohort (`runner.peers`); every `exp:content` delivered to a seated participant
 * additionally carries that participant's group for this rotation
 * (`runner.interactionGroup`). Both already exclude the participant's own id,
 * but both are filtered again here so a future interaction pattern that includes
 * the seat itself cannot make a participant dial themselves.
 *
 * Pure by design: the client suite has no jsdom, so every decision the mesh
 * makes lives here and RoutineVideoChat.svelte stays glue.
 */

/**
 * The peers this participant should currently hold a connection to.
 *
 * An interaction group always wins over the cohort — including an empty one,
 * which means "sit this rotation out" (a solo seat, or an orphan whose partner
 * withdrew). Falling back to the cohort there would silently reconnect the
 * orphan to everybody.
 *
 * `partnerUnavailable` is accepted and ignored: it drives the notice in the
 * markup, never the mesh.
 */
export function desiredPeers(
  interactionGroup: { peers: string[]; partnerUnavailable?: boolean } | null,
  sessionPeers: string[],
  selfId: string,
): string[] {
  const source = interactionGroup ? interactionGroup.peers : sessionPeers;
  const unique = new Set<string>();
  for (const peerId of source) {
    if (peerId !== selfId) {
      unique.add(peerId);
    }
  }
  return [...unique];
}
