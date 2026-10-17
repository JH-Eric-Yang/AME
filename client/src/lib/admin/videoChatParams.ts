/**
 * videoChatParams — editing a video-chat tile's channels from three toggles.
 * Pure, so the client suite covers it; the editor stays glue.
 */

import type { ChatChannel } from "ame-shared";

const ChannelOrder: readonly ChatChannel[] = ["video", "audio", "text"];

export function toggleChannel(current: readonly ChatChannel[], channel: ChatChannel, on: boolean): ChatChannel[] {
  const next = new Set(current);
  if (on) next.add(channel);
  else next.delete(channel);
  return ChannelOrder.filter((c) => next.has(c));
}
