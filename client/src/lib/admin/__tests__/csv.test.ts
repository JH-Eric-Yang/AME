import { describe, it, expect } from "vitest";
import { readCsv, writeCsv, ByteOrderMark } from "../csv";

describe("readCsv", () => {
  it("splits plain cells and lines", () => {
    expect(readCsv("a,b\nc,d")).toEqual({ rows: [["a", "b"], ["c", "d"]], error: null });
  });

  it("reads a quoted cell that holds a comma, a line break and a doubled quote", () => {
    const text = `x,"one, two","line1\nline2","say ""hi"""`;
    expect(readCsv(text).rows).toEqual([["x", "one, two", "line1\nline2", 'say "hi"']]);
  });

  it("accepts \\r\\n line ends and ignores a byte order mark", () => {
    expect(readCsv(`${ByteOrderMark}a,b\r\nc,d\r\n`).rows).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("keeps empty cells and drops blank lines", () => {
    expect(readCsv("a,,c\n\n,b,\n").rows).toEqual([["a", "", "c"], ["", "b", ""]]);
  });

  it("keeps a quote that is not at the start of a cell as text", () => {
    expect(readCsv('5" screen,b').rows).toEqual([['5" screen', "b"]]);
  });

  it("reports a quoted cell that is not closed", () => {
    expect(readCsv('a,"open\nb')).toEqual({ rows: [], error: "A quoted cell is not closed" });
  });

  it("returns no rows for empty text", () => {
    expect(readCsv("")).toEqual({ rows: [], error: null });
  });
});

describe("writeCsv", () => {
  it("quotes only the cells that need it", () => {
    expect(writeCsv([["a", "b, c", 'q"t', "l\nb", " pad"]])).toBe(`a,"b, c","q""t","l\nb"," pad"`);
  });

  it("joins lines with \\r\\n", () => {
    expect(writeCsv([["a"], ["b"]])).toBe("a\r\nb");
  });

  it("round-trips through readCsv", () => {
    const rows = [["progress", "stim.src"], ["0", "dog, brown.png"], ["1", 'say "hi"\nnow']];
    expect(readCsv(writeCsv(rows)).rows).toEqual(rows);
  });
});
