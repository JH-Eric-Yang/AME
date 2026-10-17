import { describe, it, expect } from "vitest";
import { createSignalInbox, MaxHeldSignals, SignalHoldMs, type Signal } from "../signalInbox";

const offer = (fromPeerId: string): Signal => ({ kind: "offer", fromPeerId, sdp: { type: "offer", sdp: "v=0" } });
const ice = (fromPeerId: string): Signal => ({ kind: "ice", fromPeerId, candidate: { candidate: "c" } });

describe("signalInbox", () => {
  it("holds an offer that arrives before the call, and gives it to the call when it attaches", () => {
    const inbox = createSignalInbox();
    inbox.deliver(offer("p0"));
    inbox.deliver(ice("p0"));

    const got: Signal[] = [];
    inbox.attach((s) => got.push(s));
    expect(got).toEqual([offer("p0"), ice("p0")]);

    inbox.deliver(ice("p0"));
    expect(got).toHaveLength(3);
  });

  it("does not replay a signal twice to a later call", () => {
    const inbox = createSignalInbox();
    inbox.deliver(offer("p0"));
    const first: Signal[] = [];
    const detach = inbox.attach((s) => first.push(s));
    detach();

    const second: Signal[] = [];
    inbox.attach((s) => second.push(s));
    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
  });

  it("lets only the current call detach", () => {
    const inbox = createSignalInbox();
    const oldDetach = inbox.attach(() => {});
    const got: Signal[] = [];
    inbox.attach((s) => got.push(s));
    oldDetach();
    inbox.deliver(offer("p1"));
    expect(got).toEqual([offer("p1")]);
  });

  it("drops signals older than the hold time and keeps at most the cap", () => {
    let t = 0;
    const inbox = createSignalInbox(() => t);
    inbox.deliver(offer("old"));
    t = SignalHoldMs + 1;
    for (let i = 0; i < MaxHeldSignals + 5; i++) inbox.deliver(ice(`p${i}`));

    const got: Signal[] = [];
    inbox.attach((s) => got.push(s));
    expect(got).toHaveLength(MaxHeldSignals);
    expect(got[0]).toEqual(ice("p5"));
    expect(got.some((s) => s.fromPeerId === "old")).toBe(false);
  });

  it("forgets what it holds on clear", () => {
    const inbox = createSignalInbox();
    inbox.deliver(offer("p0"));
    inbox.clear();
    const got: Signal[] = [];
    inbox.attach((s) => got.push(s));
    expect(got).toEqual([]);
  });
});
