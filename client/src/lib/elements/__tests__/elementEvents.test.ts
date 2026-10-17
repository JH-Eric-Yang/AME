import { describe, it, expect } from "vitest";
import type { ElementConfig, ElementEvent } from "ame-shared";
import { resolveEventActions, type AlertRecord, answersExhausted, hasDataEvent, submitsRoutine } from "../elementEvents";

function el(events: ElementEvent[], name = "el1"): ElementConfig {
  return { name, type: "button", params: {}, events };
}

const Now = 1_700_000_000_000;

describe("resolveEventActions", () => {
  describe("trigger matching", () => {
    it("returns nothing when the element declares no events", () => {
      const element: ElementConfig = { name: "el1", type: "button", params: {} };
      expect(resolveEventActions(element, "click", "v", {}, Now)).toEqual([]);
    });

    it("ignores events declared for a different trigger", () => {
      const element = el([{ type: "proceed", trigger: "change" }]);
      expect(resolveEventActions(element, "click", "v", {}, Now)).toEqual([]);
    });

    it("resolves every matching event in declaration order", () => {
      const element = el([
        { type: "data", trigger: "click" },
        { type: "proceed", trigger: "click" },
      ]);
      const actions = resolveEventActions(element, "click", "v", {}, Now);
      expect(actions.map((a) => a.kind)).toEqual(["data", "proceed"]);
    });

    it("resolves the press trigger used by the keyboard element", () => {
      const element = el([{ type: "proceed", trigger: "press" }]);
      expect(resolveEventActions(element, "press", "j", {}, Now)).toEqual([
        { kind: "proceed" },
      ]);
    });
  });

  describe("data events", () => {
    it("keys the recorded value by the element name by default", () => {
      const element = el([{ type: "data", trigger: "click" }]);
      expect(resolveEventActions(element, "click", 42, {}, Now)).toEqual([
        { kind: "data", key: "el1", value: 42 },
      ]);
    });

    it("prefers an explicit key from the event params", () => {
      const element = el([{ type: "data", trigger: "click", params: { key: "answer" } }]);
      expect(resolveEventActions(element, "click", 42, {}, Now)).toEqual([
        { kind: "data", key: "answer", value: 42 },
      ]);
    });
  });

  describe("complete events", () => {
    it("resolves to a complete action", () => {
      const element = el([{ type: "complete", trigger: "click" }]);
      expect(resolveEventActions(element, "click", null, {}, Now)).toEqual([
        { kind: "complete" },
      ]);
    });
  });

  describe("alert events", () => {
    it("records trigger time and a count of one on first invocation", () => {
      const element = el([{ type: "alert", trigger: "click", params: { message: "Too slow" } }]);
      const actions = resolveEventActions(element, "click", null, {}, Now);

      expect(actions).toEqual([
        {
          kind: "alert",
          key: "el1_alert",
          message: "Too slow",
          value: { message: "Too slow", timestamp: Now, count: 1 },
        },
      ]);
    });

    it("increments the count from the previously recorded alert", () => {
      const element = el([{ type: "alert", trigger: "click", params: { message: "Too slow" } }]);
      const previous: AlertRecord = { message: "Too slow", timestamp: Now - 5000, count: 2 };

      const actions = resolveEventActions(element, "click", null, { el1_alert: previous }, Now);

      expect(actions[0]).toMatchObject({ value: { count: 3, timestamp: Now } });
    });

    it("counts against an explicit key when one is given", () => {
      const element = el([
        { type: "alert", trigger: "detection", params: { key: "fov_alert", message: "Move back" } },
      ]);
      const previous: AlertRecord = { message: "Move back", timestamp: Now - 1, count: 1 };

      const actions = resolveEventActions(
        element,
        "detection",
        null,
        { fov_alert: previous },
        Now,
      );

      expect(actions[0]).toMatchObject({ key: "fov_alert", value: { count: 2 } });
    });

    it("falls back to a generic message when none is configured", () => {
      const element = el([{ type: "alert", trigger: "click" }]);
      const actions = resolveEventActions(element, "click", null, {}, Now);

      expect(actions[0]).toMatchObject({ message: "Experiment paused." });
    });

    it("ignores a malformed previous record rather than throwing", () => {
      const element = el([{ type: "alert", trigger: "click" }]);
      const actions = resolveEventActions(element, "click", null, { el1_alert: "oops" }, Now);

      expect(actions[0]).toMatchObject({ value: { count: 1 } });
    });
  });
});

describe("data events that accept more than one answer", () => {
  const clicker = (multiple?: boolean): ElementConfig => ({
    name: "pick",
    type: "button",
    params: {},
    events: [{ trigger: "click", type: "data", params: multiple === undefined ? {} : { multiple } }],
  });

  const dataActions = (element: ElementConfig, value: unknown, responses: Record<string, unknown>) =>
    resolveEventActions(element, "click", value, responses, 0).filter((a) => a.kind === "data");

  it("starts a list on the first answer", () => {
    expect(dataActions(clicker(true), "red", {})).toEqual([
      { kind: "data", key: "pick", value: ["red"] },
    ]);
  });

  it("appends each further answer in the order they were given", () => {
    const first = dataActions(clicker(true), "red", {})[0];
    const second = dataActions(clicker(true), "blue", { pick: first.value })[0];
    const third = dataActions(clicker(true), "red", { pick: second.value })[0];

    expect(third.value).toEqual(["red", "blue", "red"]);
  });

  it("keeps a single earlier answer by wrapping it, rather than dropping it", () => {
    // The flag can be turned on after a participant has already answered, and
    // an experiment can be edited mid-run. Losing the first answer would be
    // silent data loss.
    expect(dataActions(clicker(true), "blue", { pick: "red" })[0].value).toEqual(["red", "blue"]);
  });

  it("locks the answer when multiple answers are disabled", () => {
    expect(dataActions(clicker(false), "red", {})).toHaveLength(1);
    expect(dataActions(clicker(false), "blue", { pick: "red" })).toEqual([]);
  });

  it("still replaces when the event says nothing, so an input can be revised", () => {
    // resolveEventActions is shared: `change` on a select or slider fires on
    // every edit and must overwrite. Only an explicit `false` locks.
    expect(dataActions(clicker(), "blue", { pick: "red" })).toEqual([
      { kind: "data", key: "pick", value: "blue" },
    ]);
  });

  it("counts answers under the event's own key, not the element name", () => {
    const element: ElementConfig = {
      name: "pick",
      type: "button",
      params: {},
      events: [{ trigger: "click", type: "data", params: { key: "choices", multiple: true } }],
    };

    expect(dataActions(element, "blue", { choices: ["red"] })[0]).toEqual({
      kind: "data",
      key: "choices",
      value: ["red", "blue"],
    });
  });
});

describe("answersExhausted", () => {
  const button = (multiple?: boolean, key?: string): ElementConfig => ({
    name: "pick",
    type: "button",
    params: {},
    events: [{ trigger: "click", type: "data", params: { multiple, key } }],
  });

  it("is false before the single answer is given", () => {
    expect(answersExhausted(button(false), {})).toBe(false);
  });

  it("is true once the single answer is in", () => {
    expect(answersExhausted(button(false), { pick: "red" })).toBe(true);
  });

  it("watches the event's own key", () => {
    expect(answersExhausted(button(false, "choices"), { pick: "red" })).toBe(false);
    expect(answersExhausted(button(false, "choices"), { choices: "red" })).toBe(true);
  });

  it("is never true while more answers are welcome", () => {
    expect(answersExhausted(button(true), { pick: ["red", "blue"] })).toBe(false);
    expect(answersExhausted(button(undefined), { pick: "red" })).toBe(false);
  });

  it("is false for an element that records nothing", () => {
    const proceedOnly: ElementConfig = {
      name: "next",
      type: "button",
      params: {},
      events: [{ trigger: "click", type: "proceed" }],
    };
    expect(answersExhausted(proceedOnly, { next: true })).toBe(false);
  });
});

describe("hasDataEvent", () => {
  it("finds a data event on the matching trigger", () => {
    const element: ElementConfig = {
      name: "pick", type: "button", params: {},
      events: [{ trigger: "click", type: "data" }],
    };
    expect(hasDataEvent(element, "click")).toBe(true);
    expect(hasDataEvent(element, "change")).toBe(false);
  });

  it("ignores events of other types on that trigger", () => {
    const element: ElementConfig = {
      name: "next", type: "button", params: {},
      events: [{ trigger: "click", type: "proceed" }],
    };
    expect(hasDataEvent(element, "click")).toBe(false);
  });
});

describe("submitsRoutine", () => {
  const withEvents = (events: ElementConfig["events"]): ElementConfig => ({
    name: "next", type: "button", params: {}, events,
  });

  it("is true for a button that advances the routine", () => {
    expect(submitsRoutine(withEvents([{ trigger: "click", type: "proceed" }]), "click")).toBe(true);
  });

  it("is true for a button that ends the experiment", () => {
    expect(submitsRoutine(withEvents([{ trigger: "click", type: "complete" }]), "click")).toBe(true);
  });

  it("is false for a button that only records", () => {
    // A tally button stays live: pressing it again is the whole point.
    expect(submitsRoutine(withEvents([{ trigger: "click", type: "data" }]), "click")).toBe(false);
  });

  it("is false for a button with no events at all", () => {
    expect(submitsRoutine(withEvents(undefined), "click")).toBe(false);
  });

  it("only counts the trigger being fired", () => {
    expect(submitsRoutine(withEvents([{ trigger: "press", type: "proceed" }]), "click")).toBe(false);
  });
});
