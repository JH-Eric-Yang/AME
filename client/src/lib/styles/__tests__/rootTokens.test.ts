import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The root layout's `:root` block is the only source of the colour tokens.
 * A token that refers to itself (`--black: var(--black)`) is invalid CSS and
 * silently drops every colour that uses it, and no e2e test checks colour.
 */
const LayoutPath = fileURLToPath(new URL("../../../routes/+layout.svelte", import.meta.url));

const ColourTokens = [
  "black", "white", "gray-50", "gray-100", "gray-200", "gray-300", "gray-400",
  "gray-500", "gray-600", "gray-700", "accent", "danger", "success",
];

function rootTokens(): Map<string, string> {
  const source = readFileSync(LayoutPath, "utf8");
  const block = source.match(/:global\(:root\)\s*\{([^}]*)\}/);
  if (!block) throw new Error("Root token block not found in +layout.svelte");
  const tokens = new Map<string, string>();
  for (const m of block[1].matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) tokens.set(m[1], m[2].trim());
  return tokens;
}

describe("root colour tokens", () => {
  it("gives every colour token a literal hex value", () => {
    const tokens = rootTokens();
    for (const name of ColourTokens) {
      expect(tokens.get(name), `--${name}`).toMatch(/^#[0-9a-f]{3,6}$/i);
    }
  });

  it("has no token that refers to itself", () => {
    for (const [name, value] of rootTokens()) {
      expect(value, `--${name}`).not.toContain(`var(--${name})`);
    }
  });
});
