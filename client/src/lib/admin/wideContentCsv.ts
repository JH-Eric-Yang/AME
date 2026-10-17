// client/src/lib/admin/wideContentCsv.ts
/**
 * The wide content CSV (spec §3): fixed columns, then one `<element>.<param>`
 * column per param. Media cells hold file names from the asset library.
 * All-or-nothing, as `parseContentCsv`: one bad cell gives no rows.
 */
import type { ElementType, RoutineConfig } from "ame-shared";
import { getParamInfo, stimulusParams } from "ame-shared/parameterHelp";
import type { SequenceRow } from "ame-shared/progressSequence";
import type { AssetSummary } from "$lib/api";
import { AssetRefPrefix, assetRef } from "$lib/media/assetSrc";
import { ByteOrderMark, readCsv, writeCsv } from "./csv";
import { cellToValue, mediaKind, valueToCell, type CellValue } from "./paramValues";
import type { ParsedContentCsv, ParsedContentRow } from "./contentCsv";

export const WideFixedColumns = ["progress", "trialNumber", "routine", "condition"] as const;
const DefaultCondition = "Basic";
const DefaultTrialNumber = 1;
/** The example rows a starter CSV carries. */
const StarterRowCount = 2;
/** A media cell that starts with one of these is a source already, not a file name. */
const SourcePrefixes = ["http://", "https://", "/api/", "ref:", AssetRefPrefix];
/** Separates the element from the param in a column name. */
const ColumnSeparator = ".";
const FallbackFileStem = "experiment";

interface ParamColumn {
  name: string;
  element: string;
  param: string;
}

/** Element names may hold a dot; param names do not — so split at the last one. */
function paramColumn(name: string): ParamColumn | null {
  const at = name.lastIndexOf(ColumnSeparator);
  if (at <= 0 || at === name.length - 1) return null;
  return { name, element: name.slice(0, at), param: name.slice(at + 1) };
}

const article = (word: string): string => (/^[aeiou]/.test(word) ? "an" : "a");

function byFileName(assets: AssetSummary[]): Map<string, AssetSummary[]> {
  const map = new Map<string, AssetSummary[]>();
  for (const asset of assets) map.set(asset.fileName, [...(map.get(asset.fileName) ?? []), asset]);
  return map;
}

/** The legacy format has a `content` column, or no header at all. */
export function isLegacyCsv(text: string): boolean {
  const source = text.startsWith(ByteOrderMark) ? text.slice(ByteOrderMark.length) : text;
  const firstLine = source.trimStart().split(/\r?\n/, 1)[0] ?? "";
  const cells = firstLine.split(",").map((cell) => cell.trim().toLowerCase());
  return cells.includes("content") || /^\d+$/.test(cells[0] ?? "");
}

function mediaValue(raw: string, named: Map<string, AssetSummary[]>): CellValue {
  const name = raw.trim();
  if (SourcePrefixes.some((prefix) => name.startsWith(prefix))) return { value: name, error: null };
  const matches = named.get(name) ?? [];
  if (matches.length === 1) return { value: assetRef(matches[0].id), error: null };
  if (matches.length === 0) return { value: null, error: `no uploaded file is named "${name}"` };
  return { value: null, error: `${matches.length} uploaded files are named "${name}"; rename one in the asset library` };
}

export function parseWideCsv(text: string, routines: RoutineConfig[], assets: AssetSummary[]): ParsedContentCsv {
  const fail = (error: string): ParsedContentCsv => ({ rows: [], error });
  const read = readCsv(text);
  if (read.error) return fail(read.error);
  if (read.rows.length === 0) return { rows: [], error: null };

  const [header, ...body] = read.rows;
  const names = header.map((name) => name.trim());
  if (WideFixedColumns.some((column, i) => names[i] !== column)) {
    return fail(`Line 1: the header must start with ${WideFixedColumns.join(",")}`);
  }
  const isBlank = (cell: string | undefined) => (cell ?? "").trim() === "";
  // Excel pads a sheet to its used range: skip empty columns and blank rows.
  const dataRows = body.map((cells, index) => ({ cells, line: index + 2 })).filter(({ cells }) => !cells.every(isBlank));
  const columns: (ParamColumn & { at: number })[] = [];
  for (const [offset, name] of names.slice(WideFixedColumns.length).entries()) {
    const at = WideFixedColumns.length + offset;
    if (name === "") {
      if (dataRows.some(({ cells }) => !isBlank(cells[at]))) {
        return fail(`Line 1: column ${at + 1} has no name. Type <element>.<param> in its header cell.`);
      }
      continue;
    }
    const column = paramColumn(name);
    if (!column) return fail(`Line 1: column "${name}" is not <element>.<param>`);
    if (columns.some((c) => c.name === name)) return fail(`Line 1: column "${name}" appears twice`);
    columns.push({ ...column, at });
  }

  const routineByName = new Map(routines.map((r) => [r.name, r]));
  const named = byFileName(assets);
  const rows: ParsedContentRow[] = [];

  for (const { cells, line } of dataRows) {
    const fixed = (i: number) => (cells[i] ?? "").trim();

    const rawProgress = fixed(0);
    const progress = Number(rawProgress);
    if (rawProgress === "" || !Number.isInteger(progress)) {
      return fail(`Line ${line}: progress "${rawProgress}" is not a whole number`);
    }
    const rawTrial = fixed(1);
    const trialNumber = rawTrial === "" ? DefaultTrialNumber : Number(rawTrial);
    if (!Number.isInteger(trialNumber) || trialNumber < 1) {
      return fail(`Line ${line}: trialNumber "${rawTrial}" is not a whole number of 1 or more`);
    }
    const routineName = fixed(2);
    const routine = routineByName.get(routineName);
    if (!routine) {
      return fail(routineName === "" ? `Line ${line}: routine name is required` : `Line ${line}: routine "${routineName}" does not exist`);
    }
    const condition = fixed(3) || DefaultCondition;

    const content: Record<string, Record<string, unknown>> = {};
    for (const column of columns) {
      const raw = cells[column.at] ?? "";
      if (raw.trim() === "") continue;
      const where = `Line ${line}, column ${column.name}`;
      const element = routine.elements.find((e) => e.name === column.element);
      if (!element) return fail(`${where}: routine "${routine.name}" has no element "${column.element}"`);
      const info = getParamInfo(element.type, column.param);
      if (!info) return fail(`${where}: ${article(element.type)} ${element.type} element has no param "${column.param}"`);
      const parsed = mediaKind(element.type, column.param) ? mediaValue(raw, named) : cellToValue(info, raw);
      if (parsed.error !== null) return fail(`${where}: ${parsed.error}`);
      (content[column.element] ??= {})[column.param] = parsed.value;
    }
    rows.push({ progress, trialNumber, routine: routine.name, condition, content });
  }
  return { rows, error: null };
}

/** One param value as a cell: a unique asset as its file name, else by type. */
function cellWriter(assets: AssetSummary[]) {
  const named = byFileName(assets);
  const byRef = new Map(assets.map((a) => [assetRef(a.id), a]));
  return (elementType: ElementType | undefined, param: string, value: unknown): string => {
    if (elementType && mediaKind(elementType, param) && typeof value === "string") {
      const asset = byRef.get(value);
      return asset && named.get(asset.fileName)?.length === 1 ? asset.fileName : value;
    }
    const info = elementType ? getParamInfo(elementType, param) : null;
    if (info) return valueToCell(info, value);
    if (value === undefined || value === null) return "";
    return typeof value === "string" ? value : JSON.stringify(value);
  };
}

const isOverride = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function writeWideCsv(rows: SequenceRow[], routines: RoutineConfig[], assets: AssetSummary[]): string {
  const sorted = [...rows].sort(
    (a, b) => a.condition.localeCompare(b.condition) || a.progress - b.progress || a.trialNumber - b.trialNumber,
  );
  const names: string[] = [];
  for (const row of sorted) {
    for (const [element, override] of Object.entries(row.content)) {
      if (!isOverride(override)) continue;
      for (const param of Object.keys(override)) {
        const name = `${element}${ColumnSeparator}${param}`;
        if (!names.includes(name)) names.push(name);
      }
    }
  }
  const columns = names.map((name) => paramColumn(name)!);
  const write = cellWriter(assets);
  const routineByName = new Map(routines.map((r) => [r.name, r]));

  const body = sorted.map((row) => {
    const elements = routineByName.get(row.routine)?.elements ?? [];
    return [
      String(row.progress), String(row.trialNumber), row.routine, row.condition,
      ...columns.map(({ element, param }) => {
        const override = row.content[element];
        const value = isOverride(override) ? override[param] : undefined;
        return write(elements.find((e) => e.name === element)?.type, param, value);
      }),
    ];
  });
  return writeCsv([[...WideFixedColumns, ...names], ...body]);
}

/**
 * `startProgress` is the condition's step count: rows at a progress already in
 * use would join that step (or duplicate it) on import, not add new steps.
 */
export function starterCsv(routine: RoutineConfig, condition: string, startProgress: number, assets: AssetSummary[]): string {
  const columns = routine.elements.flatMap((element) => stimulusParams(element.type).map((param) => ({ element, param })));
  const write = cellWriter(assets);
  const example = (progress: number) => [
    String(progress), String(DefaultTrialNumber), routine.name, condition,
    ...columns.map(({ element, param }) => write(element.type, param, (element.params as Record<string, unknown>)[param])),
  ];
  return writeCsv([
    [...WideFixedColumns, ...columns.map(({ element, param }) => `${element.name}${ColumnSeparator}${param}`)],
    ...Array.from({ length: StarterRowCount }, (_, i) => example(startProgress + i)),
  ]);
}

export function csvFileName(experimentName: string, suffix: string): string {
  const stem = experimentName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || FallbackFileStem;
  return `${stem}-${suffix}.csv`;
}
