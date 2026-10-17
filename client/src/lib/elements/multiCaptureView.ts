import type { MultiCaptureParams } from "ame-shared";

export interface MultiCaptureView {
  /** The QR code is for a missing device; once all are connected it only gets in the way. */
  showQrCode: boolean;
  showStart: boolean;
  startByItself: boolean;
  /** A pairing step with every device connected: tell the participant they can go on. */
  paired: boolean;
  /** The Stop Recording button, while recording. */
  showStop: boolean;
}

type ViewParams = Pick<MultiCaptureParams, "autoStart" | "pairOnly" | "showPairing" | "showPreview" | "showStopButton">;

/** What the multi-capture screen shows. */
export function multiCaptureView(params: ViewParams, allConnected: boolean): MultiCaptureView {
  const records = params.pairOnly !== true;
  return {
    showQrCode: !allConnected && params.showPairing !== false,
    showStart: records && allConnected,
    startByItself: records && allConnected && params.autoStart === true,
    paired: !records && allConnected,
    // Before showStopButton existed, showPreview: false hid the button; keep that.
    showStop: params.showStopButton ?? params.showPreview !== false,
  };
}
