/**
 * signalInbox — WebRTC signals that arrive before the call is ready.
 *
 * Only the participant with the lower id sends an offer, and only once
 * (PeerManager.updatePeers). When the other browser has not built its call
 * yet, a socket listener registered by the call would miss that offer, and
 * neither side would ever see the other. The socket hands every signal to this
 * inbox instead: it goes straight to the call when one is attached, and is
 * held until one attaches otherwise.
 */

export type Signal =
  | { kind: "offer"; fromPeerId: string; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; fromPeerId: string; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; fromPeerId: string; candidate: RTCIceCandidateInit };

/** A held signal older than this belongs to an attempt the sender gave up on. */
export const SignalHoldMs = 30_000;
/** At most this many held signals; the oldest go first. */
export const MaxHeldSignals = 200;

export interface SignalInbox {
  deliver(signal: Signal): void;
  /** Sends the held signals, in order, then every new one. Returns a detach function. */
  attach(handler: (signal: Signal) => void): () => void;
  clear(): void;
}

export function createSignalInbox(now: () => number = Date.now): SignalInbox {
  let handler: ((signal: Signal) => void) | null = null;
  let held: Array<{ signal: Signal; at: number }> = [];

  const fresh = () => held.filter((entry) => now() - entry.at <= SignalHoldMs);

  return {
    deliver(signal) {
      if (handler) {
        handler(signal);
        return;
      }
      held = [...fresh(), { signal, at: now() }].slice(-MaxHeldSignals);
    },
    attach(next) {
      handler = next;
      const replay = fresh();
      held = [];
      for (const entry of replay) next(entry.signal);
      // Only the current handler may detach: an old call tearing down must not deafen the new one.
      return () => {
        if (handler === next) handler = null;
      };
    },
    clear() {
      held = [];
    },
  };
}

/** The one inbox the experiment socket feeds and the call reads. */
export const signalInbox = createSignalInbox();
