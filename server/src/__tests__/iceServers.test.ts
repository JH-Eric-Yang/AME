import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { iceServersFor, turnSettingsFromEnv, StunServers, DefaultTurnTtlSeconds } from "../iceServers.js";

const Now = 1_700_000_000_000;

describe("iceServersFor", () => {
  it("gives STUN only when TURN is not configured", () => {
    expect(iceServersFor({ urls: "", secret: "s", ttlSeconds: 60 }, Now)).toEqual({ iceServers: [...StunServers], expiresAt: null });
    expect(iceServersFor({ urls: "turn:a:3478", secret: "", ttlSeconds: 60 }, Now).iceServers).toEqual([...StunServers]);
  });

  it("adds TURN with a coturn use-auth-secret password", () => {
    const { iceServers, expiresAt } = iceServersFor(
      { urls: " turn:turn.example.com:3478?transport=udp , turn:turn.example.com:3478?transport=tcp ", secret: "shh", ttlSeconds: 600 },
      Now,
    );
    const expiry = Now / 1000 + 600;
    expect(expiresAt).toBe(expiry * 1000);
    expect(iceServers.slice(0, StunServers.length)).toEqual([...StunServers]);
    expect(iceServers.at(-1)).toEqual({
      urls: ["turn:turn.example.com:3478?transport=udp", "turn:turn.example.com:3478?transport=tcp"],
      username: `${expiry}:ame`,
      credential: createHmac("sha1", "shh").update(`${expiry}:ame`).digest("base64"),
    });
  });
});

describe("turnSettingsFromEnv", () => {
  it("reads the three variables and defaults a missing or bad TTL", () => {
    expect(turnSettingsFromEnv({ TURN_URLS: "turn:a", TURN_SECRET: "s", TURN_TTL_SECONDS: "120" })).toEqual({ urls: "turn:a", secret: "s", ttlSeconds: 120 });
    expect(turnSettingsFromEnv({}).ttlSeconds).toBe(DefaultTurnTtlSeconds);
    expect(turnSettingsFromEnv({ TURN_TTL_SECONDS: "-5" }).ttlSeconds).toBe(DefaultTurnTtlSeconds);
  });
});
