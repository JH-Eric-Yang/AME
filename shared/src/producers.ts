/**
 * producers — what referencing an element yields, looking at its params where
 * the type alone cannot say. A `video-chat` tile produces a recording, a
 * transcript, or nothing depending on `record` and `channels`; every other type
 * is decided by `refKind`.
 *
 * The resolver, the validator, the Progress tab's summary and the picker all
 * ask this, so they cannot disagree about a tile.
 */

import type { ElementConfig, VideoChatParams } from "./types.js";
import { refKind, type RefKind } from "./refs.js";
import { hasTextChannel, tileProducerKind, tileRecords, TranscriptSuffix } from "./videoChat.js";

const VideoChatType = "video-chat";

export function elementRefKind(element: Pick<ElementConfig, "type" | "params">): RefKind | null {
  if (element.type === VideoChatType) return tileProducerKind(element.params as VideoChatParams);
  return refKind(element.type);
}

function recordsWithText(element: ElementConfig): boolean {
  if (element.type !== VideoChatType) return false;
  const params = element.params as VideoChatParams;
  return tileRecords(params) && hasTextChannel(params);
}

/**
 * A tile that records and has text keeps its transcript under
 * `<tile>__transcript`, because the recording owns the tile's name. That name
 * reads as the tile's text thread: the same tile with `record` off, so
 * `elementRefKind` calls it a value and a `.text` field joins its messages.
 */
function transcriptOf(tile: ElementConfig): ElementConfig {
  return {
    ...tile,
    name: `${tile.name}${TranscriptSuffix}`,
    params: { ...(tile.params as VideoChatParams), record: false },
  } as ElementConfig;
}

/** The element a ref's element name reads: an element of that name, or a recorded tile's transcript. */
export function referencedElement(elements: readonly ElementConfig[], name: string): ElementConfig | undefined {
  const exact = elements.find((element) => element.name === name);
  if (exact || !name.endsWith(TranscriptSuffix)) return exact;
  const tileName = name.slice(0, -TranscriptSuffix.length);
  const tile = elements.find((element) => element.name === tileName);
  return tile && recordsWithText(tile) ? transcriptOf(tile) : undefined;
}

/** Every name a ref can read in these elements, in authoring order: each element, then a recorded tile's transcript. */
export function referableElements(elements: readonly ElementConfig[]): ElementConfig[] {
  return elements.flatMap((element) => (recordsWithText(element) ? [element, transcriptOf(element)] : [element]));
}
