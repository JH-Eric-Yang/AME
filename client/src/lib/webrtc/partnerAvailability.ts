/**
 * Decides whether a video-chat participant is looking at an empty tile because
 * they have no partner this rotation, rather than because a connection is still
 * being negotiated. Pure, so the client suite (which has no jsdom) can cover it.
 */

export const DefaultPartnerUnavailableText =
  "Your partner is no longer available. The study will continue.";

/**
 * Whether the participant has left the waiting room, either into a session or
 * because matching timed out with `timeoutAction: "proceed"`. The two need the
 * same screen — the routine, not the matching overlay — but only the timeout
 * needs the partner-unavailable notice, which falls out of an empty session.
 *
 * `sessionId` is tested for truthiness, not for null: RoutineEndMatching clears
 * a finished session with an EMPTY string, and that must read as "no session".
 * `memberCount` covers a reload: `match:matched` is not re-sent, so sessionId
 * stays null, but every in-session `exp:content` carries the session's members.
 * The same clear empties them.
 */
export function isReleasedFromMatching(input: {
  sessionId: string | null;
  matchingTimedOut: boolean;
  memberCount: number;
}): boolean {
  return Boolean(input.sessionId) || input.memberCount > 0 || input.matchingTimedOut;
}

export interface PartnerNoticeInput {
  /** The participant is in a session (match:matched has landed). */
  matched: boolean;
  /** The server's verdict for this rotation: no ACTIVE peer in a cohort of more than one. */
  partnerUnavailable: boolean;
  /** Peers the server assigned for this rotation — [] means nobody is left. */
  desiredPeers: readonly string[];
  /** Peers whose remote stream has actually arrived. */
  connectedPeers: readonly string[];
  /** A partner-withdrawn alert has been received during this routine. */
  partnerDropped: boolean;
  /** Experimenter override from RoutineVideoChatConfig. */
  customText?: string | null;
}

export function resolvePartnerNotice(input: PartnerNoticeInput): string | null {
  const {
    matched,
    partnerUnavailable,
    desiredPeers,
    connectedPeers,
    partnerDropped,
    customText,
  } = input;
  if (!matched) return null;

  const text = customText?.trim() || DefaultPartnerUnavailableText;
  if (partnerUnavailable) return text;
  if (desiredPeers.length === 0) return text;
  // A partner assigned but never arriving is only a notice once we have lost
  // them; before the first stream lands it is ordinary negotiation.
  if (partnerDropped && connectedPeers.length === 0) return text;
  return null;
}
