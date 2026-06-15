import { beforeAll, describe, expect, it } from "vitest";
import { signToken, validateUsername, verifyToken } from "../src/auth.js";

describe("validateUsername", () => {
  it("accepts 3–16 lowercase / digit / underscore", () => {
    expect(validateUsername("rider_99").ok).toBe(true);
    expect(validateUsername("abc").ok).toBe(true);
  });
  it("rejects too short, too long, uppercase, symbols, non-strings", () => {
    expect(validateUsername("ab").ok).toBe(false);
    expect(validateUsername("x".repeat(17)).ok).toBe(false);
    expect(validateUsername("BigRig").ok).toBe(false);
    expect(validateUsername("has space").ok).toBe(false);
    expect(validateUsername("dash-no").ok).toBe(false);
    expect(validateUsername(42).ok).toBe(false);
  });
});

describe("JWT round-trip", () => {
  beforeAll(() => {
    // Must satisfy the 32-char minimum the server now enforces.
    process.env.JWT_SECRET = "test-secret-for-vitest-0123456789abcdef";
  });

  it("signs and verifies {playerId, username}", () => {
    const token = signToken({ playerId: "p-123", username: "rider_99" });
    expect(verifyToken(token)).toEqual({ playerId: "p-123", username: "rider_99" });
  });

  it("rejects a garbage token", () => {
    expect(() => verifyToken("not.a.jwt")).toThrow();
  });
});
