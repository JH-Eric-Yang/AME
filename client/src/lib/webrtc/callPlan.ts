/**
 * callPlan — what a routine's video-chat tiles ask of the call (spec §6.1,
 * §6.2): who each tile shows, what this participant publishes and receives,
 * and whom to dial.
 *
 * Pure, so the client suite (no jsdom, no WebRTC) covers every decision;
 * callSession and the tile components stay glue.
 */

import type { ChatChannel, ElementConfig, RoutineVideoChatConfig, SessionMember, VideoChatParams } from "ame-shared";
import { parseParticipantRef } from "ame-shared/refs";
import { resolveParticipant, type AddressingContext, type AddressingFailure } from "ame-shared/participantRef";
import {
  hasTextChannel,
  mediaChannels,
  resolveVideoLayout,
  tileChannels,
  tileParticipant,
  tileRecords,
  type MediaChannel,
} from "ame-shared/videoChat";
import { desiredPeers } from "./peerSelection";

export type TileFailure = AddressingFailure | "invalid-participant";

export interface ResolvedTile {
  name: string;
  /** The tile shows the viewer (their camera, never their own audio). */
  self: boolean;
  /** Who the tile shows; null when the address names nobody this step. */
  participantId: string | null;
  failure: TileFailure | null;
  channels: ChatChannel[];
  media: MediaChannel[];
  text: boolean;
  mirror: boolean;
  label: string;
  record: boolean;
}

export interface Publish {
  video: boolean;
  audio: boolean;
}

export interface CallPlan {
  publish: Publish;
  /** Media kinds a remote tile renders; the initiator asks for them even when not sending them. */
  receive: MediaChannel[];
  peers: string[];
}

export const EmptyPlan: CallPlan = { publish: { video: false, audio: false }, receive: [], peers: [] };

/** routine-video-chat's own self tile; `recordLocal` uploads under this name. */
export const AutoSelfTileName = "local-video";
const AutoPeerTilePrefix = "peer-";

/** How long a recorded tile waits for all its listed tracks before recording what has arrived. */
export const RecordingStartGraceMs = 5000;

const MediaOrder: readonly MediaChannel[] = ["video", "audio"];
const VideoChatRoutine = "routine-video-chat";

/** The slice of the runner store the call depends on. */
export interface RunnerCallView {
  participantId: string;
  sessionId: string | null;
  peers: string[];
  sessionMembers: SessionMember[];
  interactionGroup: { peers: string[]; members?: SessionMember[] } | null;
  routine: { type: string; config?: unknown } | null;
  elements: ElementConfig[];
}

export function addressingContext(view: RunnerCallView): AddressingContext {
  // Members, not sessionId: a reload re-sends sessionMembers with exp:content but
  // never re-sends match:matched, so sessionId stays null for the rest of the
  // block. RoutineEndMatching's clear empties the members too.
  const session = view.sessionMembers.length > 0 ? { members: view.sessionMembers } : null;
  if (!session) return { selfId: view.participantId, session: null, group: null };
  // Until content names the group, the group is the cohort — as desiredPeers falls back to runner.peers.
  return { selfId: view.participantId, session, group: { members: view.interactionGroup?.members ?? session.members } };
}

export function resolveTile(name: string, params: VideoChatParams, ctx: AddressingContext): ResolvedTile {
  const base = {
    name,
    channels: tileChannels(params),
    media: mediaChannels(params),
    text: hasTextChannel(params),
    label: params.label ?? "",
    record: tileRecords(params),
  };
  // The mirror default follows the RESOLVED self flag, not the address text — a
  // seat:n that happens to name the viewer mirrors, same as an explicit "self".
  const withSelf = (self: boolean, participantId: string | null, failure: TileFailure | null): ResolvedTile => ({
    ...base,
    self,
    participantId,
    failure,
    mirror: params.mirror ?? self,
  });
  const ref = parseParticipantRef(tileParticipant(params));
  if (!ref) return withSelf(false, null, "invalid-participant");
  const result = resolveParticipant(ref, ctx);
  if (!result.ok) return withSelf(false, null, result.reason);
  return withSelf(result.participantId === ctx.selfId, result.participantId, null);
}

export function autoTiles(input: { selfId: string; peers: readonly string[]; recordLocal: boolean }): ResolvedTile[] {
  const auto = (name: string, participantId: string, self: boolean, record: boolean): ResolvedTile => ({
    name,
    self,
    participantId,
    failure: null,
    channels: [...MediaOrder],
    media: [...MediaOrder],
    text: false,
    mirror: self,
    label: "",
    record,
  });
  return [
    auto(AutoSelfTileName, input.selfId, true, input.recordLocal),
    ...input.peers
      .filter((peerId) => peerId !== input.selfId)
      .map((peerId) => auto(`${AutoPeerTilePrefix}${peerId}`, peerId, false, false)),
  ];
}

function groupPeersOf(view: RunnerCallView): string[] {
  return desiredPeers(view.interactionGroup, view.peers, view.participantId);
}

export function tilesFor(view: RunnerCallView): ResolvedTile[] {
  const ctx = addressingContext(view);
  const own = view.elements
    .filter((element) => element.type === "video-chat")
    .map((element) => resolveTile(element.name, element.params as VideoChatParams, ctx));
  if (view.routine?.type !== VideoChatRoutine) return own;
  const config = (view.routine.config ?? {}) as RoutineVideoChatConfig;
  // A custom layout shows only what the researcher placed, so it draws no panel tiles.
  if (resolveVideoLayout(config) === "custom") return own;
  return [
    ...autoTiles({ selfId: view.participantId, peers: groupPeersOf(view), recordLocal: config.recordLocal === true }),
    ...own,
  ];
}

export function planCall(tiles: readonly ResolvedTile[], groupPeers: readonly string[], selfId: string): CallPlan {
  const selves = tiles.filter((t) => t.self);
  const others = tiles.filter((t) => !t.self);
  const published = new Set((selves.length > 0 ? selves : others).flatMap((t) => t.media));
  const publish = { video: published.has("video"), audio: published.has("audio") };
  const publishing = publish.video || publish.audio;

  const reachable = others.filter((t) => t.participantId !== null && t.media.length > 0);
  const receive = MediaOrder.filter((kind) => reachable.some((t) => t.media.includes(kind)));
  if (!publishing && receive.length === 0) return EmptyPlan;

  // Group-wide while publishing: PeerManager closes any connection missing from
  // the local list, so a one-sided tile list would tear down the call the other
  // member's screen needs.
  const peers = new Set([...(publishing ? groupPeers : []), ...reachable.map((t) => t.participantId!)]);
  peers.delete(selfId);
  return { publish, receive, peers: [...peers].sort() };
}

export function planFor(view: RunnerCallView): CallPlan {
  if (!view.participantId) return EmptyPlan;
  return planCall(tilesFor(view), groupPeersOf(view), view.participantId);
}

export function samePlan(a: CallPlan, b: CallPlan): boolean {
  const sameList = (x: readonly string[], y: readonly string[]) => x.length === y.length && x.every((v, i) => v === y[i]);
  return (
    a.publish.video === b.publish.video &&
    a.publish.audio === b.publish.audio &&
    sameList(a.receive, b.receive) &&
    sameList(a.peers, b.peers)
  );
}

export type MediaAction = "keep" | "acquire" | "release" | "replace";

export function mediaAction(current: Publish | null, next: Publish): MediaAction {
  const wants = next.video || next.audio;
  if (!current) return wants ? "acquire" : "keep";
  if (!wants) return "release";
  return current.video === next.video && current.audio === next.audio ? "keep" : "replace";
}

export type TileStatus = "live" | "connecting" | "waiting" | "unavailable";

export function tileStatus(
  tile: ResolvedTile,
  input: { matched: boolean; hasStream: boolean; partnerDropped: boolean },
): TileStatus {
  if (tile.self) return input.hasStream ? "live" : "connecting";
  if (tile.participantId === null) {
    return tile.failure === "no-session" && !input.matched ? "waiting" : "unavailable";
  }
  if (input.hasStream) return "live";
  return input.partnerDropped ? "unavailable" : "connecting";
}

export function tilePlayback(tile: ResolvedTile): { showVideo: boolean; playAudio: boolean } {
  return { showVideo: tile.media.includes("video"), playAudio: !tile.self && tile.media.includes("audio") };
}

/**
 * Which kinds a recorded tile should record now, or null to keep waiting.
 * MediaRecorder cannot take a track added after it starts, so it waits for
 * every listed kind, then settles for what has arrived.
 */
export function recordingKinds(
  wanted: readonly MediaChannel[],
  available: readonly MediaChannel[],
  waitedMs: number,
): MediaChannel[] | null {
  const present = wanted.filter((kind) => available.includes(kind));
  if (present.length > 0 && present.length === wanted.length) return present;
  if (waitedMs >= RecordingStartGraceMs && present.length > 0) return present;
  return null;
}
