/**
 * SignalingClient — bridges signaling to PeerManager. It sends offer, answer
 * and ICE candidates on the experiment socket, and receives them from the
 * signal inbox, which the socket feeds.
 */

import { getSocket } from "$lib/socket/experimentSocket";
import { signalInbox } from "./signalInbox";

export interface SignalingHandlers {
  onOffer: (fromPeerId: string, sdp: RTCSessionDescriptionInit) => void;
  onAnswer: (fromPeerId: string, sdp: RTCSessionDescriptionInit) => void;
  onIce: (fromPeerId: string, candidate: RTCIceCandidateInit) => void;
}

export class SignalingClient {
  private readonly detach: () => void;

  constructor(handlers: SignalingHandlers) {
    // The inbox replays any signal that arrived before this call existed.
    this.detach = signalInbox.attach((signal) => {
      if (signal.kind === "offer") handlers.onOffer(signal.fromPeerId, signal.sdp);
      else if (signal.kind === "answer") handlers.onAnswer(signal.fromPeerId, signal.sdp);
      else handlers.onIce(signal.fromPeerId, signal.candidate);
    });
  }

  sendOffer(targetPeerId: string, sdp: RTCSessionDescriptionInit): void {
    const socket = getSocket();
    socket?.emit("signal:offer", {
      targetPeerId,
      sdp: sdp as { type: "offer" | "answer"; sdp?: string },
    });
  }

  sendAnswer(targetPeerId: string, sdp: RTCSessionDescriptionInit): void {
    const socket = getSocket();
    socket?.emit("signal:answer", {
      targetPeerId,
      sdp: sdp as { type: "offer" | "answer"; sdp?: string },
    });
  }

  sendIce(targetPeerId: string, candidate: RTCIceCandidateInit): void {
    const socket = getSocket();
    socket?.emit("signal:ice", { targetPeerId, candidate });
  }

  dispose(): void {
    this.detach();
  }
}
