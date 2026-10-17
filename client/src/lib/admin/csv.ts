/**
 * CSV as RFC 4180 defines it — what Excel and Google Sheets save. A quoted
 * cell may hold commas, line breaks and `""` for one quote character. A quote
 * that is not at the start of a cell is plain text, as Excel reads it.
 */

/** Excel needs this mark to read a UTF-8 file as UTF-8; the reader drops it. */
export const ByteOrderMark = "\uFEFF";
const Quote = '"';
/** A cell with one of these characters, or with outer spaces, must be quoted. */
const NeedsQuotes = /[",\r\n]|^\s|\s$/;

export interface ReadCsvResult {
  rows: string[][];
  /** Null when the text parsed; otherwise one message. */
  error: string | null;
}

export function readCsv(text: string): ReadCsvResult {
  const source = text.startsWith(ByteOrderMark) ? text.slice(ByteOrderMark.length) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let cellStarted = false;

  const endCell = () => {
    row.push(cell);
    cell = "";
    cellStarted = false;
  };
  const endRow = () => {
    endCell();
    // A blank line is one empty cell: drop it rather than make an empty row.
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch !== Quote) cell += ch;
      else if (source[i + 1] === Quote) { cell += Quote; i++; }
      else quoted = false;
      continue;
    }
    if (ch === Quote && !cellStarted) { quoted = true; cellStarted = true; continue; }
    if (ch === ",") { endCell(); continue; }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      endRow();
      continue;
    }
    cell += ch;
    cellStarted = true;
  }

  if (quoted) return { rows: [], error: "A quoted cell is not closed" };
  if (cellStarted || row.length > 0) endRow();
  return { rows, error: null };
}

const writeCell = (cell: string): string =>
  NeedsQuotes.test(cell) ? `${Quote}${cell.replace(/"/g, '""')}${Quote}` : cell;

export function writeCsv(rows: string[][]): string {
  return rows.map((row) => row.map(writeCell).join(",")).join("\r\n");
}
