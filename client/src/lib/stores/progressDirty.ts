import { writable } from "svelte/store";

/**
 * True while the Progress tab holds sequence edits it has not saved. The tab
 * mirrors its own `dirty` flag here and clears it on destroy; the experiment
 * page reads it before switching tabs, because leaving the tab unmounts it and
 * the local rows go with it.
 *
 * A store rather than props: the page owns the tab state, the tab owns the rows.
 */
export const progressDirty = writable(false);
