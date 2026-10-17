import { describe, it, expect } from "vitest";
import { experimenterFromAuthHeader } from "../assets/assetAuth.js";
import { signToken } from "../middleware/auth.js";

const Token = signToken({ experimenterId: "exp-1", email: "a@b.com", role: "ADMIN" });

describe("experimenterFromAuthHeader", () => {
  it("returns the experimenter id from a bearer token", () => {
    expect(experimenterFromAuthHeader(`Bearer ${Token}`)).toBe("exp-1");
  });

  it("rejects a missing header", () => {
    expect(() => experimenterFromAuthHeader(null)).toThrow();
  });

  it("rejects a header that is not a bearer token", () => {
    expect(() => experimenterFromAuthHeader("Basic abc")).toThrow();
  });

  it("rejects a forged token", () => {
    expect(() => experimenterFromAuthHeader("Bearer not.a.token")).toThrow();
  });

  it("throws a shape tus turns into a 401", () => {
    try {
      experimenterFromAuthHeader(null);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toMatchObject({ status_code: 401 });
    }
  });
});
