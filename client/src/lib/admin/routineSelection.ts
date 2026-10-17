/**
 * Which routine the Builder canvas should have selected.
 *
 * The store starts at `selectedRoutineIndex: null` and `removeRoutine()`
 * returns it to null, so without this the Builder tab opens — and a routine
 * deletion lands — on "Select a routine to view its canvas." with no grid at
 * all. Nothing in the UI deselects a routine on purpose, so an absent
 * selection is always a state to recover from rather than one to preserve.
 *
 * Returns the index that should be selected, or null when the experiment has
 * no routines to select. The result is idempotent: feeding it back in returns
 * it unchanged, which is what lets the caller's effect settle.
 */
export function resolveRoutineSelection(
  routineCount: number,
  selected: number | null,
): number | null {
  if (routineCount === 0) return null;
  if (selected === null) return 0;
  // A selection can outlive the routine it pointed at, so clamp rather than
  // trusting it: removeRoutine() shortens the array under it.
  return Math.min(Math.max(selected, 0), routineCount - 1);
}
