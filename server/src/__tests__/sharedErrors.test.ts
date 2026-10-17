import { describe, it, expect } from "vitest";
import { describeError, truncateReport, stripTokens, ErrorLimits } from "ame-shared/errors";

describe("describeError", () => {
  it("reads name, message and stack from an Error", () => {
    const err = new TypeError("camera busy");
    expect(describeError(err)).toMatchObject({ name: "TypeError", message: "camera busy" });
    expect(describeError(err).stack).toContain("TypeError");
  });

  it("handles a thrown string", () => {
    expect(describeError("boom")).toEqual({ name: "Error", message: "boom", stack: undefined });
  });

  it("handles a thrown object with no message", () => {
    expect(describeError({ code: 7 })).toMatchObject({ name: "Error" });
    expect(describeError({ code: 7 }).message.length).toBeGreaterThan(0);
  });
});

describe("truncateReport", () => {
  it("caps every field at its limit", () => {
    const report = truncateReport({
      name: "N".repeat(500),
      message: "M".repeat(5000),
      stack: "S".repeat(20000),
      routine: "consent",
      progress: 2,
      context: { note: "x".repeat(5000) },
    });

    expect(report.name).toHaveLength(ErrorLimits.name);
    expect(report.message).toHaveLength(ErrorLimits.message);
    expect(report.stack).toHaveLength(ErrorLimits.stack);
    expect(report.routine).toBe("consent");
    expect(report.progress).toBe(2);
    expect(JSON.stringify(report.context).length).toBeLessThanOrEqual(ErrorLimits.context);
  });

  it("survives a payload of the wrong shape, because the client is untrusted", () => {
    expect(truncateReport(null)).toMatchObject({ name: "Error", message: "" });
    expect(truncateReport({ name: 7, message: {}, progress: "nope" })).toMatchObject({
      name: "Error",
      message: "",
      progress: undefined,
    });
  });
});

describe("stripTokens", () => {
  it("removes a signed media token from a url", () => {
    expect(stripTokens("/api/uploads/abc?token=eyJhbGciOi.secret")).toBe("/api/uploads/abc?token=REDACTED");
  });

  it("leaves a url with no token alone", () => {
    expect(stripTokens("/api/admin/experiments/1")).toBe("/api/admin/experiments/1");
  });
});
