/**
 * Pure set diff between the peer connections a participant currently holds and
 * the ones their next interaction group requires. No DOM and no WebRTC, so it
 * is unit-testable in the client suite.
 */

export interface PeerDiff {
  toOpen: string[];
  toClose: string[];
  unchanged: string[];
}

/**
 * Diff live peer ids against the desired peer ids.
 * Duplicates are collapsed and every list is sorted, so a rotation produces the
 * same plan regardless of the order the server listed the group in.
 */
export function diffPeers(current: string[], desired: string[]): PeerDiff {
  const currentSet = new Set(current);
  const desiredSet = new Set(desired);

  return {
    toOpen: [...desiredSet].filter((id) => !currentSet.has(id)).sort(),
    toClose: [...currentSet].filter((id) => !desiredSet.has(id)).sort(),
    unchanged: [...currentSet].filter((id) => desiredSet.has(id)).sort(),
  };
}
