/**
 * filterValues — turning what an experimenter typed in a `PropertyFilter`'s
 * value box into the filter's stored value, and back. Pure, so the client
 * suite covers it.
 *
 * Ruling: a value typed in double quotes always compares as that string, so
 * a textfield answer like `"18"` can be matched without becoming the number
 * 18. `evaluateFilters` (shared/src/propertyFilters.ts) never sees quotes —
 * they are only this editor's typing convention.
 */

import type { PropertyFilterOperator } from "ame-shared";

const QuoteChar = '"';
const InSeparator = ",";

function isQuoted(text: string): boolean {
  return text.length >= 2 && text.startsWith(QuoteChar) && text.endsWith(QuoteChar);
}

function looksNumeric(text: string): boolean {
  return text.length > 0 && Number.isFinite(Number(text));
}

function looksBoolean(text: string): boolean {
  return text === "true" || text === "false";
}

/** The single-value parsing rule, shared by the plain and `in` cases. */
function parseSingleValue(text: string): unknown {
  if (isQuoted(text)) return text.slice(1, -1);
  if (text === "true") return true;
  if (text === "false") return false;
  if (looksNumeric(text)) return Number(text);
  return text;
}

export function parseFilterValue(text: string, operator: PropertyFilterOperator): unknown {
  if (operator === "in") {
    return text.split(InSeparator).map((item) => parseSingleValue(item.trim()));
  }
  return parseSingleValue(text);
}

/** The single-value formatting rule, shared by the plain and array cases. */
function formatSingleValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") {
    // A non-empty string that would otherwise round-trip through
    // parseFilterValue as a number or boolean is quoted so it is visibly a
    // string comparison. An empty string stays empty — it is an empty box
    // (or an empty `in` item), not a quoted empty string — so PropertyFilterEditor's
    // per-keystroke re-format never re-seeds `""` into the input as the
    // participant types.
    if (value !== "" && (looksNumeric(value) || looksBoolean(value))) return `${QuoteChar}${value}${QuoteChar}`;
    return value;
  }
  return String(value);
}

export function formatFilterValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => formatSingleValue(item)).join(", ");
  return formatSingleValue(value);
}
