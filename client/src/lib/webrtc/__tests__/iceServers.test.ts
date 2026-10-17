import { describe, it, expect } from "vitest";
import { connectIceServers, iceServers, needsRefresh, parseIceServerList, DefaultIceServers, RefreshMarginMs } from "../iceServers";

describe("needsRefresh", () => {
  it("never refreshes a list without TURN", () => {
    expect(needsRefresh(null, Date.now())).toBe(false);
  });

  it("refreshes inside the margin before expiry", () => {
    const expiresAt = 10 * RefreshMarginMs;
    expect(needsRefresh(expiresAt, expiresAt - RefreshMarginMs - 1)).toBe(false);
    expect(needsRefresh(expiresAt, expiresAt - RefreshMarginMs)).toBe(true);
    expect(needsRefresh(expiresAt, expiresAt + 1)).toBe(true);
  });
});

describe("parseIceServerList", () => {
  it("accepts the server's reply", () => {
    const body = { iceServers: [{ urls: "stun:a" }, { urls: ["turn:b"], username: "1:ame", credential: "c" }], expiresAt: 5 };
    expect(parseIceServerList(body)).toEqual(body);
    expect(parseIceServerList({ iceServers: [{ urls: "stun:a" }], expiresAt: null })).toEqual({ iceServers: [{ urls: "stun:a" }], expiresAt: null });
  });

  it("refuses a reply of the wrong shape", () => {
    expect(parseIceServerList(null)).toBeNull();
    expect(parseIceServerList("<html>")).toBeNull();
    expect(parseIceServerList({ iceServers: [] })).toBeNull();
    expect(parseIceServerList({ iceServers: [{ username: "x" }] })).toBeNull();
  });
});

describe("connectIceServers", () => {
  it("uses the server's list, ignores a bad one, and asks once for a new password near expiry", () => {
    expect(iceServers()).toEqual([...DefaultIceServers]);
    let asked = 0;
    const apply = connectIceServers(() => asked++);

    const turn = { urls: ["turn:b"], username: "1:ame", credential: "c" };
    apply({ iceServers: [{ urls: "stun:a" }, turn], expiresAt: Date.now() + 10 * RefreshMarginMs });
    apply("not a list");
    expect(iceServers()).toEqual([{ urls: "stun:a" }, turn]);
    expect(asked).toBe(0);

    apply({ iceServers: [turn], expiresAt: Date.now() });
    iceServers();
    iceServers();
    expect(asked).toBe(1);

    apply({ iceServers: [turn], expiresAt: Date.now() });
    iceServers();
    expect(asked).toBe(2);
  });
});
