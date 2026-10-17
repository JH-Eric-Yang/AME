import { describe, it, expect } from "vitest";
import {
  parseRef,
  formatRef,
  parseParticipantRef,
  formatParticipantRef,
  isRef,
  findTemplateRefs,
  replaceTemplateRefs,
  forEachString,
  mapDeep,
  findRefs,
  remapPositionRefs,
  refKind,
  type ParsedRef,
} from "ame-shared/refs";

describe("parseParticipantRef", () => {
  it("parses the four forms", () => {
    expect(parseParticipantRef("self")).toEqual({ kind: "self" });
    expect(parseParticipantRef("partner")).toEqual({ kind: "partner", k: 1 });
    expect(parseParticipantRef("partner:3")).toEqual({ kind: "partner", k: 3 });
    expect(parseParticipantRef("seat:2")).toEqual({ kind: "seat", n: 2 });
  });

  it("rejects zero, negative, non-numeric and unknown forms", () => {
    expect(parseParticipantRef("partner:0")).toBeNull();
    expect(parseParticipantRef("seat:0")).toBeNull();
    expect(parseParticipantRef("seat:-1")).toBeNull();
    expect(parseParticipantRef("seat:x")).toBeNull();
    expect(parseParticipantRef("me")).toBeNull();
    expect(parseParticipantRef("")).toBeNull();
  });

  it("round-trips through formatParticipantRef", () => {
    for (const s of ["self", "partner", "partner:2", "seat:4"]) {
      expect(formatParticipantRef(parseParticipantRef(s)!)).toBe(s);
    }
  });
});

describe("parseRef", () => {
  it("parses a positional self ref", () => {
    expect(parseRef("ref:self/p3/recorder-1")).toEqual({
      who: { kind: "self" },
      where: { kind: "position", n: 3 },
      element: "recorder-1",
    });
  });

  it("parses p0 as the first step", () => {
    expect(parseRef("ref:self/p0/name")?.where).toEqual({ kind: "position", n: 0 });
  });

  it("parses a trial ref with and without a routine qualifier", () => {
    expect(parseRef("ref:partner/t2/recorder-1")).toEqual({
      who: { kind: "partner", k: 1 },
      where: { kind: "trial", k: 2 },
      element: "recorder-1",
    });
    expect(parseRef("ref:self/t2:post-survey/survey-1.q1")).toEqual({
      who: { kind: "self" },
      where: { kind: "trial", k: 2, routine: "post-survey" },
      element: "survey-1",
      field: "q1",
    });
  });

  it("keeps dots inside the field so nested paths work", () => {
    expect(parseRef("ref:seat:1/p1/survey-1.page.q3")).toEqual({
      who: { kind: "seat", n: 1 },
      where: { kind: "position", n: 1 },
      element: "survey-1",
      field: "page.q3",
    });
  });

  it("returns null for anything malformed, never a partial", () => {
    for (const bad of [
      "",
      "ref:",
      "ref:self",
      "ref:self/p3",
      "ref:self/p3/",
      "ref:self/3/recorder-1",
      "ref:self/p-1/recorder-1",
      "ref:self/t0/recorder-1",
      "ref:self/p3/rec/extra",
      "ref:self/p3/.q1",
      "ref:self/p3/recorder-1.",
      "asset:abc",
      "ref:self/p3/recorder 1",
    ]) {
      expect(parseRef(bad), bad).toBeNull();
    }
  });

  it("round-trips through formatRef", () => {
    for (const s of [
      "ref:self/p3/recorder-1",
      "ref:partner/t2/recorder-1",
      "ref:partner:2/t2:post-survey/survey-1.q1",
      "ref:seat:4/p0/name",
    ]) {
      expect(formatRef(parseRef(s)!)).toBe(s);
    }
  });
});

describe("isRef", () => {
  it("is true only for strings carrying the prefix", () => {
    expect(isRef("ref:self/p0/x")).toBe(true);
    expect(isRef("asset:abc")).toBe(false);
    expect(isRef(42)).toBe(false);
    expect(isRef(null)).toBe(false);
  });
});

describe("findTemplateRefs", () => {
  it("finds every {{ref:…}} occurrence in order, tolerating inner whitespace", () => {
    expect(
      findTemplateRefs("You said {{ref:self/p0/name}} and {{ ref:self/p1/age }}. {{ref:self/p0/name}}"),
    ).toEqual(["ref:self/p0/name", "ref:self/p1/age", "ref:self/p0/name"]);
  });

  it("ignores braces that do not wrap a ref", () => {
    expect(findTemplateRefs("{{n}} {{asset:x}} {ref:self/p0/x}")).toEqual([]);
  });
});

describe("replaceTemplateRefs", () => {
  it("leaves text with no match unchanged", () => {
    expect(replaceTemplateRefs("no refs here", () => "X")).toBe("no refs here");
  });

  it("replaces a single match with the callback's return, dropping the braces", () => {
    expect(replaceTemplateRefs("Hi {{ref:self/p0/name}}!", () => "Ada")).toBe("Hi Ada!");
  });

  it("replaces multiple matches independently, tolerating inner whitespace", () => {
    const out = replaceTemplateRefs("{{ref:self/p0/a}} and {{ ref:self/p0/b }}", (raw) =>
      raw.split("/").pop()!,
    );
    expect(out).toBe("a and b");
  });
});

describe("forEachString", () => {
  it("visits every string depth-first, in order, over nested arrays and objects", () => {
    const seen: string[] = [];
    forEachString({ a: "1", list: ["2", { b: "3" }], n: 4, z: null }, (s) => seen.push(s));
    expect(seen).toEqual(["1", "2", "3"]);
  });

  it("visits a single top-level string", () => {
    const seen: string[] = [];
    forEachString("solo", (s) => seen.push(s));
    expect(seen).toEqual(["solo"]);
  });
});

describe("mapDeep", () => {
  it("replaces a string leaf with a non-string value", () => {
    expect(mapDeep({ a: "x" }, (s) => (s === "x" ? 7 : s))).toEqual({ a: 7 });
  });

  it("rebuilds arrays and objects without mutating the input", () => {
    const input = { list: ["a", "b"], nested: { c: "d" } };
    const out = mapDeep(input, (s) => s.toUpperCase());
    expect(out).toEqual({ list: ["A", "B"], nested: { c: "D" } });
    expect(input).toEqual({ list: ["a", "b"], nested: { c: "d" } });
  });

  it("leaves non-string primitives and null alone", () => {
    expect(mapDeep({ n: 3, b: true, z: null }, () => "unused")).toEqual({ n: 3, b: true, z: null });
  });
});

describe("findRefs", () => {
  it("collects whole-value and template refs recursively, skipping malformed ones", () => {
    const found = findRefs({
      src: "ref:self/p0/clip",
      content: "Hi {{ref:self/p0/name}}",
      nested: { list: ["ref:partner/t1/rec", "plain", "ref:bad"] },
      n: 3,
    });
    expect(found.map(formatRef)).toEqual([
      "ref:self/p0/clip",
      "ref:self/p0/name",
      "ref:partner/t1/rec",
    ]);
  });
});

describe("remapPositionRefs", () => {
  const shift = (n: number) => (n >= 2 ? n + 1 : n);

  it("rewrites p<N> in whole values and templates, leaves t<K> alone", () => {
    const input = {
      src: "ref:self/p2/clip",
      content: "{{ref:self/p1/name}} {{ref:self/p5/age}}",
      trial: "ref:self/t2/rec",
      other: ["ref:seat:1/p3/x", 7, null],
    };
    expect(remapPositionRefs(input, shift)).toEqual({
      src: "ref:self/p3/clip",
      content: "{{ref:self/p1/name}} {{ref:self/p6/age}}",
      trial: "ref:self/t2/rec",
      other: ["ref:seat:1/p4/x", 7, null],
    });
  });

  it("does not mutate its input", () => {
    const input = { src: "ref:self/p2/clip" };
    remapPositionRefs(input, shift);
    expect(input.src).toBe("ref:self/p2/clip");
  });
});

describe("refKind", () => {
  it("classifies producers and returns null for pure stimuli", () => {
    expect(refKind("recorder")).toBe("media");
    expect(refKind("input-file-picker")).toBe("media");
    expect(refKind("video-chat")).toBe("media");
    expect(refKind("multi-capture")).toBeNull();
    expect(refKind("survey")).toBe("value");
    expect(refKind("input-textfield")).toBe("value");
    expect(refKind("keyboard")).toBe("value");
    expect(refKind("text")).toBeNull();
    expect(refKind("image")).toBeNull();
  });
});

// Type-level check that ParsedRef is exported.
const _typed: ParsedRef | null = parseRef("ref:self/p0/x");
void _typed;
