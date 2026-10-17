/** Column order the Content tab documents and parses. */
export const ContentCsvHeader = "progress,trialNumber,routine,condition,content";

/** Fixed columns before the content JSON, which may itself contain commas. */
const FixedColumnCount = 4;
const DefaultCondition = "Basic";
const DefaultTrialNumber = 1;

export interface ParsedContentRow {
  progress: number;
  trialNumber: number;
  routine: string;
  condition: string;
  content: Record<string, unknown>;
}

export interface ParsedContentCsv {
  rows: ParsedContentRow[];
  /** Null when every line parsed; otherwise one message naming the bad line. */
  error: string | null;
}

/**
 * Parse the Content tab's CSV textarea.
 *
 * All-or-nothing: one bad line yields no rows and one message, so a partially
 * understood paste can never be half-uploaded. Line numbers are 1-based within
 * the trimmed text, counting the header if one is present.
 */
export function parseContentCsv(text: string): ParsedContentCsv {
  const trimmed = text.trim();
  if (trimmed === "") return { rows: [], error: null };

  const lines = trimmed.split(/\r?\n/);
  const rows: ParsedContentRow[] = [];

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (line.trim() === "") continue;

    const cells = line.split(",");
    const rawProgress = cells[0]?.trim() ?? "";
    if (index === 0 && rawProgress.toLowerCase() === "progress") continue;

    const progress = Number(rawProgress);
    if (rawProgress === "" || !Number.isInteger(progress)) {
      return { rows: [], error: `Line ${lineNumber}: progress "${rawProgress}" is not a whole number` };
    }

    const rawTrial = cells[1]?.trim() ?? "";
    const trialNumber = rawTrial === "" ? DefaultTrialNumber : Number(rawTrial);
    if (!Number.isInteger(trialNumber) || trialNumber < 1) {
      return { rows: [], error: `Line ${lineNumber}: trialNumber "${rawTrial}" is not a whole number of 1 or more` };
    }

    const routine = cells[2]?.trim() ?? "";
    if (routine === "") {
      return { rows: [], error: `Line ${lineNumber}: routine name is required` };
    }

    const condition = cells[3]?.trim() || DefaultCondition;

    const rawContent = cells.slice(FixedColumnCount).join(",").trim();
    let content: Record<string, unknown> = {};
    if (rawContent !== "") {
      try {
        content = JSON.parse(rawContent) as Record<string, unknown>;
      } catch (e) {
        const reason = e instanceof Error ? e.message : "unparseable";
        return { rows: [], error: `Line ${lineNumber}: content is not valid JSON (${reason})` };
      }
    }

    rows.push({ progress, trialNumber, routine, condition, content });
  }

  return { rows, error: null };
}
