import { describe, it, expect } from "vitest";
import { sdpFingerprint } from "../sdpFingerprint";

describe("sdpFingerprint", () => {
  it("reads the fingerprint value from a CRLF session description", () => {
    const sdp = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\na=fingerprint:sha-256 AB:CD:EF\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n";
    expect(sdpFingerprint(sdp)).toBe("sha-256 AB:CD:EF");
  });

  it("takes the first occurrence and trims it", () => {
    const sdp = "v=0\na=fingerprint:  sha-256 11:22  \na=fingerprint:sha-256 33:44\n";
    expect(sdpFingerprint(sdp)).toBe("sha-256 11:22");
  });

  it("is null when the description has no fingerprint", () => {
    expect(sdpFingerprint("v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n")).toBeNull();
  });

  it("is null for an empty fingerprint line", () => {
    expect(sdpFingerprint("v=0\r\na=fingerprint:   \r\n")).toBeNull();
  });

  it("is null when there is no description", () => {
    expect(sdpFingerprint(undefined)).toBeNull();
    expect(sdpFingerprint("")).toBeNull();
  });
});
