/**
 * defaultValueField — turning what an experimenter typed into an option
 * group's `defaultValue`. Pure, so the client suite covers it.
 */

import type { InputOptionGroupParams } from "ame-shared";
import { isRef } from "ame-shared/refs";

const ListSeparator = ",";

export function optionGroupDefaultPatch(
  value: string | number | undefined,
  optionType: InputOptionGroupParams["optionType"],
): InputOptionGroupParams["defaultValue"] | undefined {
  if (value === undefined) return undefined;
  const text = String(value);
  // `isRef` narrows to `string`, which `text` already is — assigning the
  // result to a plain `boolean` avoids TS narrowing `text` to `never` in the
  // fallthrough branch below.
  const looksLikeRef: boolean = isRef(text);
  if (looksLikeRef || optionType !== "checkbox") return text;
  const values = text.split(ListSeparator).map((v) => v.trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}
