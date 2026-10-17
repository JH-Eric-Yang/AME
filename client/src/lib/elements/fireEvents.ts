/**
 * fireEvents — applies an element's declared events to the runner store and socket.
 *
 * Thin glue over `resolveEventActions`, which holds the dispatch rules.
 */

import { get } from "svelte/store";
import type { ElementConfig, EventTrigger } from "ame-shared";
import { runner } from "$lib/stores/runner";
import * as socket from "$lib/socket/experimentSocket";
import { resolveEventActions, hasDataEvent } from "./elementEvents";
import { recordsDefault } from "./inputDefaults";

/**
 * Where an element's interactions go when this page is not the one that owns
 * the experiment's state.
 *
 * The phone renders the same elements through the same renderer, but it must
 * not record anything: the desktop runner is the single writer, and a second
 * writer is the whole class of bug this avoids. The phone installs a sink that
 * forwards the intent over `device:input`; the desktop leaves it null and
 * records as usual.
 */
export type ElementIntentSink = (
  element: ElementConfig,
  trigger: EventTrigger,
  value: unknown,
) => void;

let intentSink: ElementIntentSink | null = null;

export function sendIntentsTo(sink: ElementIntentSink | null): void {
  intentSink = sink;
}

/** Upload the routine's responses so far, then advance to the next progress. */
export function submitAndProceed(): void {
  // Read the responses when the proceed goes out, not at the click: a
  // recording stopped by this proceed adds its response when its upload ends.
  socket.emitProceed(() => {
    const state = get(runner);
    socket.emitData(
      state.progress,
      state.trial,
      state.routine?.name ?? "",
      state.responses,
      state.trialInfo,
    );
  });
}

/**
 * Fire every event the element declares for `trigger`.
 *
 * @param value the response value carried by data events
 */
export function fireElementEvents(
  element: ElementConfig,
  trigger: EventTrigger,
  value: unknown,
): void {
  // Divert on the phone even for elements that don't route through
  // `recordAndFire` at all (a timer fires its own events without recording
  // anything of its own first) — the desktop is still the only writer.
  if (intentSink) {
    intentSink(element, trigger, value);
    return;
  }

  const actions = resolveEventActions(
    element,
    trigger,
    value,
    get(runner).responses,
    Date.now(),
  );

  for (const action of actions) {
    switch (action.kind) {
      case "data":
        runner.setResponse(action.key, action.value);
        break;

      case "proceed":
        submitAndProceed();
        break;

      case "complete":
        socket.emitComplete();
        break;

      case "alert":
        // An Alert always records a Data event alongside pausing the experiment.
        runner.setResponse(action.key, action.value);
        runner.setError(action.message);
        break;
    }
  }
}

/**
 * Record an element's own value and fire its events for `trigger`.
 *
 * Elements used to write the response themselves and then fire, which wrote
 * the same answer twice whenever a data event was declared. Harmless while
 * every write replaced the last, but not once a data event can accumulate: the
 * event read back the value the component had just written and counted the
 * first answer twice, and `multiple: false` could never lock anything, because
 * the component's own write kept overwriting.
 *
 * So a declared data event owns the recording — its key, and how many answers
 * it takes. Only an element with no data event on this trigger falls back to
 * writing under its own name, which is what keeps every event-less element in
 * the library recording exactly as before.
 */
export function recordAndFire(
  element: ElementConfig,
  trigger: EventTrigger,
  value: unknown,
): void {
  // This guard is duplicated in `fireElementEvents`, deliberately: this one
  // must run BEFORE the local `setResponse` write below, so a phone never
  // records its own copy under the element name before diverting. The one in
  // `fireElementEvents` covers callers — like a timer — that fire events
  // without any local write of their own. With both in place `recordAndFire`
  // returns first, so the sink fires exactly once, never twice.
  if (intentSink) {
    intentSink(element, trigger, value);
    return;
  }

  if (!hasDataEvent(element, trigger)) {
    runner.setResponse(element.name, value);
  }
  fireElementEvents(element, trigger, value);
}

/**
 * Record an input's pre-filled default as its answer. Not a participant action,
 * so on the phone (an intent sink is installed) nothing is written or forwarded:
 * the desktop is the single writer and records its own copy when it renders one.
 */
export function recordDefault(
  element: ElementConfig,
  value: string | string[] | number | null,
): void {
  if (intentSink) return;
  if (!recordsDefault(element, value)) return;
  runner.setResponse(element.name, value);
}
