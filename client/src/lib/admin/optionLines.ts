/**
 * The "value|label, one per line" text format the option-group and select
 * editors share. Extracted so both parse it the same way.
 */

export interface OptionLine {
  value: string;
  label: string;
}

/** Only the FIRST pipe separates value from label; later pipes belong to the label. */
const Separator = "|";

/**
 * Parses a multiline text format into an array of options.
 * Each line is formatted as "value|label". Only the FIRST pipe separates value from label;
 * any additional pipes belong to the label. If no pipe is present, the value is used as the label.
 * Whitespace is trimmed around values and labels, and blank lines are skipped.
 */
export function parseOptionLines(text: string): OptionLine[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf(Separator);
      if (at === -1) return { value: line, label: line };
      const value = line.slice(0, at).trim();
      const label = line.slice(at + 1).trim();
      return { value, label: label || value };
    });
}

/**
 * Formats an array of options into the multiline "value|label" text format.
 * Returns an empty string if the array is undefined or empty.
 */
export function formatOptionLines(options: OptionLine[] | undefined): string {
  return (options ?? []).map((o) => `${o.value}${Separator}${o.label}`).join("\n");
}

function sameOptions(a: OptionLine[], b: OptionLine[]): boolean {
  return a.length === b.length && a.every((o, i) => o.value === b[i].value && o.label === b[i].label);
}

/**
 * The text the Options field shows. The researcher's own text stays while it
 * still gives the stored options, so a key never rewrites it (E2E-D5); other
 * options (another element is selected) load as formatted text.
 */
export function keepOptionText(text: string, options: OptionLine[] | undefined): string {
  return sameOptions(parseOptionLines(text), options ?? []) ? text : formatOptionLines(options);
}
