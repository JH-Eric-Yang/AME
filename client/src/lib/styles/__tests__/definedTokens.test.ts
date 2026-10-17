import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A `var(--x)` with no fallback, where nothing defines `--x`, makes the whole
 * declaration invalid: a border or a fill silently disappears. Every custom
 * property a component reads must be defined somewhere in client/src.
 */
const SrcDir = fileURLToPath(new URL("../../..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
    return /\.(svelte|css|ts)$/.test(name) ? [path] : [];
  });
}

describe("custom properties", () => {
  it("reads no custom property that nothing defines", () => {
    const files = sourceFiles(SrcDir).map((path) => ({ path, text: readFileSync(path, "utf8") }));
    const defined = new Set<string>();
    for (const { text } of files) {
      // `--x:` in CSS, and `--x: …` set from a style attribute or string.
      for (const m of text.matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(m[1]);
    }
    const undefinedUses: string[] = [];
    for (const { path, text } of files) {
      for (const m of text.matchAll(/var\((--[a-z0-9-]+)\s*\)/gi)) {
        if (!defined.has(m[1])) undefinedUses.push(`${path.slice(SrcDir.length)}: ${m[1]}`);
      }
    }
    expect([...new Set(undefinedUses)]).toEqual([]);
  });
});
