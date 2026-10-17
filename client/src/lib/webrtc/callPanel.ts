/**
 * callPanel — what the automatic video panel of routine-video-chat shows:
 * the task card's title, the label on each video, how the videos are
 * arranged, and the status row. Pure, so the Svelte component stays glue.
 */

import type { SessionMember } from "ame-shared";

/** Replaced by the participant's role in a card title. */
export const RolePlaceholder = "{role}";

/** The card's title; an empty result hides the title row. */
export function cardTitle(template: string | undefined, roleName: string | null): string {
  return (template ?? "").replaceAll(RolePlaceholder, roleName ?? "").trim();
}

export interface LabelContext {
  /** How many other people the panel shows. */
  peerCount: number;
  memberRoles: Readonly<Record<string, string>>;
  members: readonly SessionMember[];
}

/** The role name when known; otherwise "Your partner" for one person, or the seat number. */
export function tileLabel(peerId: string, ctx: LabelContext): string {
  const role = ctx.memberRoles[peerId];
  if (role) return role;
  if (ctx.peerCount === 1) return "Your partner";
  const member = ctx.members.find((m) => m.participantId === peerId);
  return member ? `Participant ${member.seat + 1}` : "Participant";
}

export interface TileArrangement {
  /** 1: one large video, or two stacked. 2: a two-column grid. */
  columns: 1 | 2;
  /** True: the own video is a small inset in the corner. False: a tile in the grid. */
  selfInset: boolean;
}

/** Up to two other people, the own video is an inset; from three, every video is a grid tile. */
export function arrangeTiles(peerCount: number): TileArrangement {
  return peerCount <= 2 ? { columns: 1, selfInset: true } : { columns: 2, selfInset: false };
}

export type CallStatus = "waiting" | "connecting" | "connected";

export function callStatus(matched: boolean, desiredPeers: readonly string[], connectedPeers: readonly string[]): CallStatus {
  if (!matched) return "waiting";
  if (desiredPeers.length === 0) return "connecting";
  return desiredPeers.every((peer) => connectedPeers.includes(peer)) ? "connected" : "connecting";
}

export const CallStatusText: Record<CallStatus, string> = {
  waiting: "Waiting",
  connecting: "Connecting",
  connected: "Connected",
};
