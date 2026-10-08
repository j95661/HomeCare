import { describe, expect, it } from "vitest";
import { assertTimezone, DEFAULT_PASSWORD_MAX_AGE_DAYS, DEFAULT_TIMEZONE, expiresAt, isPasswordExpired, validatePassword } from "../functions/src/logic/password";

describe("password policy", () => {
  it("requires 8 to 200 characters with a letter and a number", () => {
    expect(validatePassword("short1")).toBe("Use at least 8 characters.");
    expect(validatePassword(`${"a".repeat(201)}1`)).toBe("That password is too long.");
    expect(validatePassword("12345678")).toBe("Include a letter.");
    expect(validatePassword("longpassword")).toBe("Include a number.");
    expect(validatePassword("goodpass1")).toBeNull();
    expect(validatePassword("GoodPass1")).toBeNull();
  });

  it("expires a password after the configured number of days, defaulting to 183", () => {
    expect(DEFAULT_PASSWORD_MAX_AGE_DAYS).toBe(183);
    const start = new Date("2026-01-01T00:00:00Z");
    const end = expiresAt(start, 183);
    expect(end.toISOString()).toBe("2026-07-03T00:00:00.000Z");
    expect(isPasswordExpired(end, new Date(end.getTime() - 1))).toBe(false);
    expect(isPasswordExpired(end, end)).toBe(true);
  });

  it("rejects an interval outside 1 to 730 whole days", () => {
    const start = new Date("2026-01-01T00:00:00Z");
    expect(() => expiresAt(start, 0)).toThrow(/1 to 730/);
    expect(() => expiresAt(start, 731)).toThrow(/1 to 730/);
    expect(() => expiresAt(start, 1.5)).toThrow(/whole number/);
    expect(expiresAt(start, 1).toISOString()).toBe("2026-01-02T00:00:00.000Z");
    expect(expiresAt(start, 730).toISOString()).toBe("2028-01-01T00:00:00.000Z");
  });

  it("accepts an IANA timezone and rejects a blank or unknown zone", () => {
    expect(DEFAULT_TIMEZONE).toBe("America/Los_Angeles");
    expect(() => assertTimezone(DEFAULT_TIMEZONE)).not.toThrow();
    expect(() => assertTimezone("")).toThrow(/timezone/);
    expect(() => assertTimezone("Not/AZone")).toThrow();
    expect(() => assertTimezone("A".repeat(81))).toThrow(/timezone/);
  });
});
