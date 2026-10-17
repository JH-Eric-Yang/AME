/**
 * One CSV cell (or one pasted line) ↔ one param value, by the param's
 * `parameterHelp` type. Spec §3.3 lists every type this handles.
 */
import type { ParamInfo } from "ame-shared/parameterHelp";

export type CellValue = { value: unknown; error: null } | { value: null; error: string };
export type MediaKind = "image" | "video" | "audio";

/** The `type` string `parameterHelp` gives an option list. */
const OptionListType = "{ value: string; label: string }[]";
const NumberTypes = new Set(["number", "number | null"]);
/** Types whose values can be objects or arrays: a `{` or `[` cell is JSON. */
const JsonTypes = new Set(["object", "object | null", "array", "DeviceSource[]", "string | string[] | null"]);
const MediaTypes = new Set<string>(["image", "video", "audio"]);
/** Separates the items of a list in one cell. */
const ListSeparator = "|";
/** Separates an option's value from its label: `v=Label`. */
const LabelSeparator = "=";

const ok = (value: unknown): CellValue => ({ value, error: null });
const bad = (error: string): CellValue => ({ value: null, error });

export function mediaKind(elementType: string, param: string): MediaKind | null {
  return param === "src" && MediaTypes.has(elementType) ? (elementType as MediaKind) : null;
}

/** A `[`-cell that is a JSON array, else the items between `|`. */
function listItems(text: string): unknown[] {
  if (text.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Not JSON: a key such as "[" is a plain item.
    }
  }
  return text.split(ListSeparator).map((item) => item.trim()).filter((item) => item !== "");
}

function toOption(item: unknown): unknown {
  if (typeof item !== "string") return item;
  const at = item.indexOf(LabelSeparator);
  return at < 0 ? { value: item, label: item } : { value: item.slice(0, at).trim(), label: item.slice(at + 1).trim() };
}

export function cellToValue(info: ParamInfo, cell: string): CellValue {
  const text = cell.trim();
  if (NumberTypes.has(info.type)) {
    const n = Number(text);
    return text !== "" && Number.isFinite(n) ? ok(n) : bad(`"${cell}" is not a number`);
  }
  if (info.type === "number | string") {
    const n = Number(text);
    return ok(text !== "" && Number.isFinite(n) ? n : cell);
  }
  if (info.type === "boolean") {
    const lower = text.toLowerCase();
    if (lower === "true") return ok(true);
    if (lower === "false") return ok(false);
    return bad(`"${cell}" is not true or false`);
  }
  if (info.type === "string[]") return ok(listItems(text));
  if (info.type === OptionListType) return ok(listItems(text).map(toOption));
  if (JsonTypes.has(info.type) && (text.startsWith("{") || text.startsWith("["))) {
    try {
      return ok(JSON.parse(text));
    } catch {
      return bad(`"${cell}" is not valid JSON`);
    }
  }
  if (info.options) {
    if (!info.options.includes(text)) return bad(`"${cell}" is not one of: ${info.options.join(", ")}`);
    return ok(text);
  }
  return ok(cell);
}

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isOptionList = (value: unknown): value is { value: string; label: string }[] =>
  Array.isArray(value) &&
  value.every((o) => typeof o === "object" && o !== null && typeof o.value === "string" && typeof o.label === "string");

/** True when an item survives `listItems` unchanged: no separator, no outer spaces. */
const plainItem = (item: string): boolean => item !== "" && !item.includes(ListSeparator) && item === item.trim();

export function valueToCell(info: ParamInfo, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (info.type === "string[]" && isStringList(value) && value.every(plainItem) && !value[0]?.startsWith("[")) {
    return value.join(ListSeparator);
  }
  if (
    info.type === OptionListType &&
    isOptionList(value) &&
    value.every((o) => plainItem(o.value) && !o.value.includes(LabelSeparator) && plainItem(o.label))
  ) {
    return value.map((o) => (o.value === o.label ? o.value : `${o.value}${LabelSeparator}${o.label}`)).join(ListSeparator);
  }
  return JSON.stringify(value);
}

export function parsePastedValues(info: ParamInfo, text: string): { values: unknown[]; error: string | null } {
  const values: unknown[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line.trim() === "") continue;
    const parsed = cellToValue(info, line);
    if (parsed.error !== null) return { values: [], error: `Line ${index + 1}: ${parsed.error}` };
    values.push(parsed.value);
  }
  return { values, error: null };
}
