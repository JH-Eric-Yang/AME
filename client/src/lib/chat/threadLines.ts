/**
 * threadLines — merging text-channel lines from history and live messages.
 * A reload can deliver a line both in the buffered history and as a live
 * message, so lines are de-duplicated by sender, time and text.
 */

import type { ChatLine, SessionMember } from "ame-shared";

// A NUL separator: a control character no chat text can contain, so it safely joins the key parts.
const KeySeparator = String.fromCharCode(0);

const lineKey = (line: ChatLine): string => [line.from, line.at, line.text].join(KeySeparator);

export function mergeLines(existing: readonly ChatLine[], incoming: readonly ChatLine[]): ChatLine[] {
  const seen = new Set(existing.map(lineKey));
  const merged = [...existing];
  for (const line of incoming) {
    const key = lineKey(line);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(line);
  }
  // Array.prototype.sort is stable, so same-millisecond lines keep arrival order.
  return merged.sort((a, b) => a.at - b.at);
}

/** How a line's sender is shown: the viewer is "You"; others by slot name, else by 1-based seat. */
export function speakerLabel(line: ChatLine, selfId: string, members: readonly SessionMember[]): string {
  if (line.from === selfId) return "You";
  const slotName = members.find((member) => member.participantId === line.from)?.slotName;
  return slotName || `Seat ${line.seat + 1}`;
}
