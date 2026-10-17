/**
 * What makes two failures "the same problem" (spec §3.1).
 *
 * Server-only, because it needs `node:crypto`; the shared package is bundled
 * into the browser and must stay free of node built-ins.
 */

import { createHash } from "node:crypto";
import type { ErrorRecord } from "./reportError.js";

const UuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const QuotedPattern = /"[^"]*"|'[^']*'/g;
const NumberPattern = /\d+/g;
/** `at fn (/path/file.ts:120:15)` → the file and function, without line or column. */
const TopFramePattern = /at\s+([^\s(]+)\s*\(?([^):]+)/;

/** The scope a group belongs to when it has no experiment. */
const PlatformScope = "platform";

export function normaliseMessage(message: string): string {
  return message
    .replace(UuidPattern, "<id>")
    .replace(QuotedPattern, "<str>")
    .replace(NumberPattern, "<n>")
    .trim();
}

function topFrame(stack: string | undefined): string {
  if (!stack) return "";
  const line = stack.split("\n").find((l) => l.includes("at "));
  const match = line ? TopFramePattern.exec(line) : null;
  return match ? `${match[2]}:${match[1]}` : "";
}

export function fingerprintFor(record: ErrorRecord): string {
  const scope = record.experimentId ?? PlatformScope;
  const parts = [record.source, record.name, normaliseMessage(record.message), topFrame(record.stack), scope];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}
