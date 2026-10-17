import type { MatchingSlot } from "ame-shared";

/**
 * The server rejects `match:join` below this. Mirrors MinimumSlotCount in
 * server/src/socket/matchingHandler.ts.
 */
export const MinSlotCount = 2;
/** A practical ceiling for one session — every seat gets a video tile. */
export const MaxSlotCount = 24;

/** Name given to a slot the editor appends; `index` is 0-based. */
function defaultSlotName(index: number): string {
  return `Slot ${index + 1}`;
}

/**
 * Resize a matching routine's slot list, preserving the name and filters of
 * every slot that survives.
 *
 * A count outside [MinSlotCount, MaxSlotCount] is clamped. A non-integer count
 * (an emptied number input yields NaN) leaves the list untouched, so clearing
 * the field mid-edit does not discard configured slots.
 */
export function resizeSlots(
  slots: MatchingSlot[],
  count: number,
): MatchingSlot[] {
  if (!Number.isInteger(count)) return slots;

  const target = Math.min(Math.max(count, MinSlotCount), MaxSlotCount);
  if (target === slots.length) return slots;
  if (target < slots.length) return slots.slice(0, target);

  const added = Array.from({ length: target - slots.length }, (_, i) => ({
    name: defaultSlotName(slots.length + i),
  }));
  return [...slots, ...added];
}
