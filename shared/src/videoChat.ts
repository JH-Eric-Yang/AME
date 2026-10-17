/**
 * videoChat — the video-chat tile model (spec §6.1): who a tile shows, what it
 * exchanges, whether it records, and how its text thread is keyed and stored.
 *
 * Pure and shared: the server keys its chat buffer with it, the validator and
 * resolver read a tile's producer kind from it, and the client builds its call
 * plan and transcript with it.
 */

import type { ChatChannel, ChatLine, RoutineVideoChatConfig, VideoChatParams, VideoLayout } from "./types.js";
import type { RefKind } from "./refs.js";

export type MediaChannel = "video" | "audio";

export const DefaultChannels: readonly ChatChannel[] = ["video", "audio"];
export const DefaultTileParticipant = "partner";
export const SelfParticipant = "self";

/** A tile that records keeps its transcript here, because the recording owns the element name. */
export const TranscriptSuffix = "__transcript";
/** The field that joins a transcript's messages: `ref:…/<tile>.text`. */
export const TranscriptTextField = "text";

const KnownChannels: ReadonlySet<ChatChannel> = new Set<ChatChannel>(["video", "audio", "text"]);
const ChatKeyPrefix = "ame:chat:";

/** A routine authored before `videoLayout` keeps its automatic video panel. */
export function resolveVideoLayout(config: RoutineVideoChatConfig | null | undefined): VideoLayout {
  return config?.videoLayout === "custom" ? "custom" : "auto";
}

export function tileParticipant(params: VideoChatParams): string {
  return params.participant?.trim() || DefaultTileParticipant;
}

export function tileChannels(params: VideoChatParams): ChatChannel[] {
  const listed = (params.channels ?? DefaultChannels).filter((c) => KnownChannels.has(c));
  return [...new Set(listed)];
}

export function mediaChannels(params: VideoChatParams): MediaChannel[] {
  return tileChannels(params).filter((c): c is MediaChannel => c !== "text");
}

export function hasTextChannel(params: VideoChatParams): boolean {
  return tileChannels(params).includes("text");
}

export function isSelfTile(params: VideoChatParams): boolean {
  return tileParticipant(params) === SelfParticipant;
}

export function tileMirror(params: VideoChatParams): boolean {
  return params.mirror ?? isSelfTile(params);
}

/** `record` only takes effect on a tile with a media channel; a text-only tile's transcript is already data. */
export function tileRecords(params: VideoChatParams): boolean {
  return params.record === true && mediaChannels(params).length > 0;
}

/** What referencing this tile yields: its recording, its transcript, or nothing. */
export function tileProducerKind(params: VideoChatParams): RefKind | null {
  if (tileRecords(params)) return "media";
  if (hasTextChannel(params)) return "value";
  return null;
}

export function transcriptKey(elementName: string, params: VideoChatParams): string {
  return tileRecords(params) ? `${elementName}${TranscriptSuffix}` : elementName;
}

export interface TranscriptLine {
  seat: number;
  text: string;
  at: number;
}

export function transcriptOf(lines: readonly ChatLine[]): TranscriptLine[] {
  return lines.map(({ seat, text, at }) => ({ seat, text, at }));
}

export function transcriptText(lines: ReadonlyArray<{ text: string }>): string {
  return lines.map((line) => line.text).join("\n");
}

/** Identifies one thread to the client: the step and the group on it. */
export function chatScope(progress: number, groupIndex: number): string {
  return `${progress}:${groupIndex}`;
}

/** The Redis list holding one thread. Outside `ame:match:*`, which the waiting-room sweeps scan. */
export function chatKey(sessionId: string, progress: number, groupIndex: number): string {
  return `${ChatKeyPrefix}${sessionId}:${chatScope(progress, groupIndex)}`;
}
