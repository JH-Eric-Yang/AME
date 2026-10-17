/**
 * refPickerContext — how a params editor asks for a reference without
 * knowing where it is mounted. The Progress tab (per step) and the Builder
 * Inspector (unrestricted) each provide a host; `MediaSourceField` and
 * `TextParamsEditor` call `useRefPicker()` and show their affordance only
 * when a host exists, so the editors' props stay unchanged.
 */

import { getContext, setContext } from "svelte";
import type { RefKind } from "ame-shared/refs";

export interface RefPickerRequest {
  /** What the surface needs: media for a `src`, null when any producer will do. */
  kind: RefKind | null;
  onpick: (ref: string) => void;
}

export interface RefPickerHost {
  open: (request: RefPickerRequest) => void;
}

const RefPickerKey = Symbol("ref-picker");

export function provideRefPicker(host: RefPickerHost): void {
  setContext(RefPickerKey, host);
}

export function useRefPicker(): RefPickerHost | null {
  return getContext<RefPickerHost | undefined>(RefPickerKey) ?? null;
}
