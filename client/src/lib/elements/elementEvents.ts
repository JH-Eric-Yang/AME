/**
 * elementEvents — resolves an element's declared events into concrete actions.
 *
 * Kept free of store and socket access so the dispatch rules are testable on
 * their own; `fireElementEvents` applies the resolved actions.
 */

import type { ElementConfig, EventTrigger } from "ame-shared";

const DefaultAlertMessage = "Experiment paused.";
const AlertKeySuffix = "_alert";

/** Recorded for every Alert event, per the AME Alert-triggers-Data rule. */
export interface AlertRecord {
  message: string;
  timestamp: number;
  count: number;
}

export type ElementAction =
  | { kind: "data"; key: string; value: unknown }
  | { kind: "proceed" }
  | { kind: "complete" }
  | { kind: "alert"; key: string; message: string; value: AlertRecord };

function isAlertRecord(value: unknown): value is AlertRecord {
  return typeof value === "object" && value !== null && "count" in value;
}

function previousAlertCount(responses: Record<string, unknown>, key: string): number {
  const previous = responses[key];
  if (!isAlertRecord(previous) || typeof previous.count !== "number") return 0;
  return previous.count;
}

/**
 * Add one answer to whatever this key already holds.
 *
 * A single earlier answer is wrapped rather than discarded: the flag can be
 * switched on after a participant has answered, and an experiment can be
 * edited while it runs. Dropping that answer would be silent data loss.
 */
function appendAnswer(previous: unknown, value: unknown): unknown[] {
  if (Array.isArray(previous)) return [...previous, value];
  if (previous === undefined) return [value];
  return [previous, value];
}

/**
 * Resolve the actions an element's events produce for a given trigger.
 *
 * @param responses the routine's responses so far, used to count repeat alerts
 * @param now timestamp recorded on alert records
 */
export function resolveEventActions(
  element: ElementConfig,
  trigger: EventTrigger,
  value: unknown,
  responses: Record<string, unknown>,
  now: number,
): ElementAction[] {
  const actions: ElementAction[] = [];

  for (const event of element.events ?? []) {
    if (event.trigger !== trigger) continue;

    switch (event.type) {
      case "data": {
        const key = event.params?.key ?? element.name;
        const previous = responses[key];
        const multiple = event.params?.multiple;

        // An explicit `false` means one answer only: the first one stands and
        // this firing records nothing. Absent means the original behaviour —
        // replace — which `change` triggers on inputs and surveys rely on to
        // let a participant revise what they entered.
        if (multiple === false && previous !== undefined) break;

        actions.push({
          kind: "data",
          key,
          value: multiple === true ? appendAnswer(previous, value) : value,
        });
        break;
      }

      case "proceed":
        actions.push({ kind: "proceed" });
        break;

      case "complete":
        actions.push({ kind: "complete" });
        break;

      case "alert": {
        const key = event.params?.key ?? `${element.name}${AlertKeySuffix}`;
        const message = event.params?.message ?? DefaultAlertMessage;
        actions.push({
          kind: "alert",
          key,
          message,
          value: {
            message,
            timestamp: now,
            count: previousAlertCount(responses, key) + 1,
          },
        });
        break;
      }
    }
  }

  return actions;
}

/** True when this trigger already records the value through a declared data event. */
export function hasDataEvent(
  element: ElementConfig,
  trigger: EventTrigger,
): boolean {
  return (element.events ?? []).some(
    (event) => event.trigger === trigger && event.type === "data",
  );
}

/**
 * True when every data event on this element has taken the one answer it
 * allows. Drives the disabled state of the control, so a participant is not
 * invited to press something that will record nothing.
 */
export function answersExhausted(
  element: ElementConfig,
  responses: Record<string, unknown>,
): boolean {
  const dataEvents = (element.events ?? []).filter((e) => e.type === "data");
  if (dataEvents.length === 0) return false;
  return dataEvents.every(
    (event) =>
      event.params?.multiple === false &&
      responses[event.params?.key ?? element.name] !== undefined,
  );
}

/**
 * True when this trigger hands the routine in — a proceed or a complete.
 *
 * Such a control has to go inert the moment it is pressed. In a matched
 * session the participant then sits at the barrier waiting for the rest of the
 * cohort, with the routine still on screen and a live-looking button in front
 * of them; pressing it again does nothing useful and reads as a broken page.
 */
export function submitsRoutine(
  element: ElementConfig,
  trigger: EventTrigger,
): boolean {
  return (element.events ?? []).some(
    (event) =>
      event.trigger === trigger &&
      (event.type === "proceed" || event.type === "complete"),
  );
}
