/**
 * sdpFingerprint — the DTLS fingerprint a session description carries.
 *
 * Each RTCPeerConnection has its own certificate, so two offers with different
 * fingerprints come from two different remote connections. PeerManager uses it
 * to tell a renegotiation (same remote pc) from a far side that reset its
 * connections and dialled again (a new pc the old one can never accept).
 */

const FingerprintPrefix = "a=fingerprint:";

/** The first `a=fingerprint:` value, trimmed; null when there is none. */
export function sdpFingerprint(sdp: string | undefined): string | null {
  if (!sdp) return null;
  const line = sdp.split(/\r?\n/).find((candidate) => candidate.startsWith(FingerprintPrefix));
  const value = line?.slice(FingerprintPrefix.length).trim();
  return value ? value : null;
}
