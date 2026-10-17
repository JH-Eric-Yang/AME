/**
 * inputDefaults — what an input starts with when its `defaultValue` is set,
 * and whether that pre-filled value is recorded as the answer.
 *
 * The server has already resolved any `ref:`, so a default here can be any
 * JSON value an earlier element recorded; each input coerces it to what it can
 * show. Pure, so the client suite covers it without a DOM.
 */

import type { ElementConfig } from "ame-shared";
import { hasDataEvent } from "./elementEvents";

/** A slider with no usable default starts here, as it always has. */
export const DefaultSliderValue = 50;

type Option = { value: string };

export function textDefault(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

const listOf = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).filter((v) => v !== null && v !== undefined).map(textDefault);

export function selectDefault(value: unknown, options: readonly Option[]): string {
  return optionGroupDefault(value, false, options) as string;
}

export function optionGroupDefault(value: unknown, multi: boolean, options: readonly Option[]): string | string[] {
  const known = new Set(options.map((option) => option.value));
  const chosen = listOf(value).filter((v) => known.has(v));
  return multi ? chosen : (chosen[0] ?? "");
}

export function numberDefault(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function sliderDefault(value: unknown, min: number, max: number): number {
  const n = numberDefault(value);
  return n === null ? DefaultSliderValue : Math.min(max, Math.max(min, n));
}

/**
 * A pre-filled value counts as the answer, unless a declared data event owns
 * how this element records (it fires on the participant's change instead).
 */
export function recordsDefault(element: ElementConfig, value: string | string[] | number | null): boolean {
  if (hasDataEvent(element, "change")) return false;
  if (value === null || value === "") return false;
  return !(Array.isArray(value) && value.length === 0);
}
