import type { QueueEntry } from "ame-shared";
import type { WaitingEntry, WaitingRoomSnapshot } from "./waitingRoomStore.js";

/** Room keys are `ame:match:<experimentId>:<routineName>`. */
const RoomKeySeparator = ":";

export function routineNameFromRoomKey(roomKey: string): string {
  const segments = roomKey.split(RoomKeySeparator);
  return segments[segments.length - 1];
}

/**
 * Strip a waiting entry down to what an admin dashboard may see. `socketId` and
 * the participant's resolved `properties` stay on the server.
 */
export function toQueueEntries(entries: readonly WaitingEntry[]): QueueEntry[] {
  return entries.map((entry) => ({
    participantId: entry.participantId,
    condition: entry.condition,
    joinedAt: entry.joinedAt,
    externalId: entry.externalId ?? null,
  }));
}

/**
 * Turn one experiment's rooms into the `queue:state` payload.
 *
 * Two room keys can only collapse onto the same routine name if they belong to
 * different experiments, and `getRoomsForExperiment` already excludes those, so
 * every routine appears exactly once.
 */
export function toQueueRooms(
  rooms: readonly WaitingRoomSnapshot[],
): Array<{ routineName: string; entries: QueueEntry[] }> {
  return rooms.map((room) => ({
    routineName: routineNameFromRoomKey(room.roomKey),
    entries: toQueueEntries(room.entries),
  }));
}
