import { describe, it, expect } from "vitest";
import { normaliseMessage, fingerprintFor } from "../errors/fingerprint.js";
import type { ErrorRecord } from "../errors/reportError.js";

const record = (over: Partial<ErrorRecord> = {}): ErrorRecord => ({
  source: "SERVER_SOCKET",
  name: "Error",
  message: "Participant 9f1c2d3e-0000-4000-8000-000000000001 not found",
  stack: "Error: x\n    at deliverContent (/app/server/src/socket/progressHandler.ts:120:15)",
  experimentId: "exp-1",
  participantId: "p-1",
  responseId: null,
  routine: null,
  progress: null,
  context: {},
  occurredAt: new Date(),
  ...over,
});

describe("normaliseMessage", () => {
  it("replaces uuids, numbers and quoted strings", () => {
    expect(normaliseMessage("Participant 9f1c2d3e-0000-4000-8000-000000000001 not found")).toBe("Participant <id> not found");
    expect(normaliseMessage("timeout after 3000ms")).toBe("timeout after <n>ms");
    expect(normaliseMessage(`unknown routine "consent"`)).toBe("unknown routine <str>");
  });
});

describe("fingerprintFor", () => {
  it("groups the same failure for different participants", () => {
    const a = fingerprintFor(record());
    const b = fingerprintFor(record({ message: "Participant 0000ffff-0000-4000-8000-000000000002 not found", participantId: "p-2" }));
    expect(a).toBe(b);
  });

  it("survives a line-number change in the top frame", () => {
    const moved = record({ stack: "Error: x\n    at deliverContent (/app/server/src/socket/progressHandler.ts:998:3)" });
    expect(fingerprintFor(record())).toBe(fingerprintFor(moved));
  });

  it("separates different experiments", () => {
    expect(fingerprintFor(record())).not.toBe(fingerprintFor(record({ experimentId: "exp-2" })));
  });

  it("separates a platform error from an experiment's", () => {
    expect(fingerprintFor(record({ experimentId: null }))).not.toBe(fingerprintFor(record()));
  });

  it("separates sources and error names", () => {
    expect(fingerprintFor(record())).not.toBe(fingerprintFor(record({ source: "CLIENT" })));
    expect(fingerprintFor(record())).not.toBe(fingerprintFor(record({ name: "TypeError" })));
  });
});
