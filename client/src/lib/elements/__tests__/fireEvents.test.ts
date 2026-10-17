import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { get } from "svelte/store";
import type { ElementConfig } from "ame-shared";
import { runner } from "$lib/stores/runner";
import { recordAndFire, fireElementEvents, recordDefault, sendIntentsTo } from "../fireEvents";

/**
 * `recordAndFire` is the rule every element records through. It is glue, but
 * the bug it exists to prevent only shows up once a component and its data
 * event both write — so it is worth pinning against the real store.
 */
const element = (events?: ElementConfig["events"]): ElementConfig => ({
  name: "pick",
  type: "button",
  params: {},
  events,
});

describe("recordAndFire", () => {
  beforeEach(() => {
    runner.reset();
  });

  it("records under the element's own name when it declares no data event", () => {
    recordAndFire(element([{ trigger: "click", type: "proceed" }]), "click", "red");

    expect(get(runner).responses).toEqual({ pick: "red" });
  });

  it("records under the element's name when it declares nothing at all", () => {
    recordAndFire(element(undefined), "click", "red");

    expect(get(runner).responses).toEqual({ pick: "red" });
  });

  it("leaves the recording to a declared data event, under that event's key", () => {
    recordAndFire(
      element([{ trigger: "click", type: "data", params: { key: "choice" } }]),
      "click",
      "red",
    );

    // No stray copy under the element name: the event's key is where the
    // researcher asked for the answer to go.
    expect(get(runner).responses).toEqual({ choice: "red" });
  });

  it("accumulates without counting the first answer twice", () => {
    // The bug this rule exists for. The component used to write the value and
    // the event then read it back as the previous answer, so one click landed
    // as two.
    const el = element([{ trigger: "click", type: "data", params: { multiple: true } }]);

    recordAndFire(el, "click", "red");
    expect(get(runner).responses.pick).toEqual(["red"]);

    recordAndFire(el, "click", "blue");
    expect(get(runner).responses.pick).toEqual(["red", "blue"]);
  });

  it("lets a locked event keep the first answer against later firings", () => {
    const el = element([{ trigger: "click", type: "data", params: { multiple: false } }]);

    recordAndFire(el, "click", "red");
    recordAndFire(el, "click", "blue");

    expect(get(runner).responses.pick).toBe("red");
  });

  it("still records for a trigger the element's data event does not cover", () => {
    // A data event on `change` must not stop a `press` from being recorded.
    const el = element([{ trigger: "change", type: "data" }]);

    recordAndFire(el, "press", "x");

    expect(get(runner).responses).toEqual({ pick: "x" });
  });
});

describe("sendIntentsTo", () => {
  const el = (events?: ElementConfig["events"]): ElementConfig => ({
    name: "send", type: "button", params: {}, events,
  });

  beforeEach(() => {
    runner.reset();
  });

  afterEach(() => {
    sendIntentsTo(null);
  });

  it("hands the intent to the sink instead of recording it", () => {
    // On the phone the desktop owns the state machine. Recording here would
    // write an answer into a store nobody uploads.
    const sink = vi.fn();
    sendIntentsTo(sink);

    recordAndFire(el([{ trigger: "click", type: "data" }]), "click", "pressed");

    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ name: "send" }), "click", "pressed");
    expect(get(runner).responses).toEqual({});
  });

  it("diverts an element that declares no events at all", () => {
    // Otherwise the phone would silently record under the element name.
    const sink = vi.fn();
    sendIntentsTo(sink);

    recordAndFire(el(undefined), "click", "pressed");

    expect(sink).toHaveBeenCalledOnce();
    expect(get(runner).responses).toEqual({});
  });

  it("goes back to recording locally once the sink is removed", () => {
    sendIntentsTo(vi.fn());
    sendIntentsTo(null);

    recordAndFire(el(undefined), "click", "pressed");

    expect(get(runner).responses).toEqual({ send: "pressed" });
  });
});

/**
 * `recordDefault` is what an input's mount-time pre-fill goes through: not a
 * participant action, so on the phone (an intent sink installed) it must write
 * and forward nothing — the desktop renders its own copy and records that.
 */
describe("recordDefault", () => {
  const el = (events?: ElementConfig["events"]): ElementConfig => ({
    name: "prefilled", type: "input-textfield", params: {}, events,
  });

  beforeEach(() => {
    runner.reset();
  });

  afterEach(() => {
    sendIntentsTo(null);
  });

  it("records a non-empty default under the element name when there is no sink", () => {
    recordDefault(el(), "Ada");

    expect(get(runner).responses).toEqual({ prefilled: "Ada" });
  });

  it("writes and forwards nothing when a sink is installed", () => {
    const sink = vi.fn();
    sendIntentsTo(sink);

    recordDefault(el(), "Ada");

    expect(sink).not.toHaveBeenCalled();
    expect(get(runner).responses).toEqual({});
  });

  it("records nothing for an empty default", () => {
    recordDefault(el(), "");

    expect(get(runner).responses).toEqual({});
  });
});

/**
 * `fireElementEvents` is the path a timer's expiry takes: unlike
 * `recordAndFire`, it never records a value under the element's own name just
 * because no `data` event claimed it. These pin the schema a timer restores
 * (no `data` event -> nothing recorded) and the phone diversion that must
 * also cover callers, like a timer, that skip `recordAndFire` entirely.
 */
describe("fireElementEvents", () => {
  const el = (events?: ElementConfig["events"]): ElementConfig => ({
    name: "countdown", type: "timer", params: {}, events,
  });

  beforeEach(() => {
    runner.reset();
  });

  afterEach(() => {
    sendIntentsTo(null);
  });

  it("hands the intent to the sink instead of recording it, with a sink installed", () => {
    const sink = vi.fn();
    sendIntentsTo(sink);

    fireElementEvents(el([{ trigger: "timeout", type: "proceed" }]), "timeout", {
      expired: true,
    });

    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ name: "countdown" }),
      "timeout",
      { expired: true },
    );
    expect(get(runner).responses).toEqual({});
  });

  it("records nothing under the element name when only proceed is declared and there is no sink", () => {
    // This is the regression: a timer whose only timeout event is `proceed`
    // must not gain a `countdown` column in the exported data.
    fireElementEvents(el([{ trigger: "timeout", type: "proceed" }]), "timeout", {
      expired: true,
      duration: 30,
      timestamp: 123,
    });

    expect(get(runner).responses).toEqual({});
  });

  it("still records under a declared data event's key", () => {
    fireElementEvents(
      el([{ trigger: "timeout", type: "data", params: { key: "expiry" } }]),
      "timeout",
      { expired: true },
    );

    expect(get(runner).responses).toEqual({ expiry: { expired: true } });
  });
});
