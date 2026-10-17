/** Characters kept in the plain `filename=`; every run of others becomes one `_`. */
const UnsafeFileNameRun = /[^A-Za-z0-9._ -]+/g;

/**
 * A `Content-Disposition` value for a download. Node throws on a header with
 * a character outside Latin-1, so an experiment named "Demo — Study" failed
 * every export; the plain name keeps safe characters only, and `filename*`
 * carries the real name for the browsers that read it (RFC 6266).
 */
export function attachmentDisposition(fileName: string): string {
  const plain = fileName.replace(UnsafeFileNameRun, "_");
  return `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** A cell that starts with one of these characters is a formula in Excel and Sheets. */
const FormulaStart = /^[=+\-@\t\r]/;
/** A plain number such as "-5" is data, not a formula, and keeps its sign. */
const PlainNumber = /^[+-]?\d+(\.\d+)?$/;

/**
 * Participant text as a CSV cell. Text that a spreadsheet would run as a
 * formula gets a leading apostrophe, so the researcher's spreadsheet shows it as text.
 */
export function csvText(text: string): string {
  return FormulaStart.test(text) && !PlainNumber.test(text) ? `'${text}` : text;
}

/** One response value as CSV text: a string through csvText, anything else as JSON, nothing as empty. */
export function csvValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? csvText(value) : JSON.stringify(value);
}
