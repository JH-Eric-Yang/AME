import { writable } from "svelte/store";

/**
 * Set to a SessionDesign id when the researcher clicks "Open" on a
 * design-owned routine in the Builder. The experiment page switches to the
 * Session tab; the Session tab then selects that block and clears this back to
 * null, so exactly one place resets it.
 *
 * A store rather than props: RoutineInspector sits three components below the
 * page that owns the tab state.
 */
export const openBlockRequest = writable<string | null>(null);
