import { describe, it, expect } from "vitest";
import { parseContentCsv, ContentCsvHeader } from "$lib/admin/contentCsv";

describe("parseContentCsv", () => {
  it("parses a header row plus one full row", () => {
    const text = `${ContentCsvHeader}\n2,3,Chat,Treatment,{"prompt":"Say hello"}`;
    expect(parseContentCsv(text)).toEqual({
      error: null,
      rows: [{ progress: 2, trialNumber: 3, routine: "Chat", condition: "Treatment", content: { prompt: "Say hello" } }],
    });
  });

  it("parses a legacy CSV that starts with a byte order mark", () => {
    const result = parseContentCsv(`\uFEFF${ContentCsvHeader}\n0,1,Chat,Basic,{}`);
    expect(result.error).toBeNull();
    expect(result.rows).toHaveLength(1);
  });

  it("accepts a body with no header line", () => {
    const result = parseContentCsv('1,1,Chat,Basic,{"prompt":"hi"}');
    expect(result.error).toBeNull();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].routine).toBe("Chat");
  });

  it("defaults a blank trial number to 1 and a blank condition to Basic", () => {
    const result = parseContentCsv(`${ContentCsvHeader}\n0,,Intro,,{}`);
    expect(result.error).toBeNull();
    expect(result.rows[0]).toEqual({ progress: 0, trialNumber: 1, routine: "Intro", condition: "Basic", content: {} });
  });

  it("keeps commas that live inside the content JSON", () => {
    const result = parseContentCsv(`${ContentCsvHeader}\n0,1,Intro,Basic,{"a":"x, y","b":2}`);
    expect(result.error).toBeNull();
    expect(result.rows[0].content).toEqual({ a: "x, y", b: 2 });
  });

  it("defaults a missing content column to an empty object", () => {
    const result = parseContentCsv(`${ContentCsvHeader}\n0,1,Intro,Basic`);
    expect(result.error).toBeNull();
    expect(result.rows[0].content).toEqual({});
  });

  it("reports invalid JSON with its line number and returns no rows", () => {
    const result = parseContentCsv(`${ContentCsvHeader}\n0,1,Intro,Basic,{oops}`);
    expect(result.rows).toEqual([]);
    expect(result.error).toContain("Line 2");
    expect(result.error).toContain("content is not valid JSON");
  });

  it("reports a progress that is not a whole number", () => {
    const result = parseContentCsv(`${ContentCsvHeader}\nabc,1,Intro,Basic,{}`);
    expect(result.rows).toEqual([]);
    expect(result.error).toBe('Line 2: progress "abc" is not a whole number');
  });

  it("reports a missing routine name", () => {
    const result = parseContentCsv(`${ContentCsvHeader}\n0,1,,Basic,{}`);
    expect(result.rows).toEqual([]);
    expect(result.error).toBe("Line 2: routine name is required");
  });

  it("returns nothing and no error for blank input", () => {
    expect(parseContentCsv("   \n  ")).toEqual({ rows: [], error: null });
  });
});
