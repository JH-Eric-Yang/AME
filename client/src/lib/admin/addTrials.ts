/** Pure helpers behind the "Add trials from stimuli" dialog. */
import type { ElementType, RoutineConfig } from "ame-shared";
import { stimulusParams } from "ame-shared/parameterHelp";
import { mediaKind, type MediaKind } from "./paramValues";

export interface TrialTarget {
  element: string;
  elementType: ElementType;
  param: string;
  /** `<element>.<param>`: the select's value and the CSV column name. */
  key: string;
  label: string;
  media: MediaKind | null;
}

export function trialTargets(routine: RoutineConfig): TrialTarget[] {
  return routine.elements.flatMap((element) =>
    stimulusParams(element.type).map((param) => ({
      element: element.name,
      elementType: element.type,
      param,
      key: `${element.name}.${param}`,
      label: `${element.name} · ${param}`,
      media: mediaKind(element.type, param),
    })),
  );
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function sortByFileName<T extends { fileName: string }>(files: T[]): T[] {
  return [...files].sort((a, b) => byName.compare(a.fileName, b.fileName));
}

export function trialsPreview(count: number, start: number, routine: string, target: TrialTarget): string {
  if (count === 1) return `Adds 1 step, p${start}, routine "${routine}", overriding ${target.key}`;
  return `Adds ${count} steps, p${start}–p${start + count - 1}, routine "${routine}", each overriding ${target.key}`;
}
