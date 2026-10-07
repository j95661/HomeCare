import { describe, expect, it } from "vitest";
import { isNewSignInMethod, needsPasswordChange, normalizeSignIn } from "../functions/src/logic/signin";

describe("sign-in method", () => {
  it("treats a missing method as password and accepts Gmail or an email code", () => {
    expect(normalizeSignIn(undefined)).toBe("password");
    expect(normalizeSignIn("")).toBe("password");
    expect(normalizeSignIn("password")).toBe("password");
    expect(normalizeSignIn("google")).toBe("google");
    expect(normalizeSignIn("email_otp")).toBe("email_otp");
    expect(isNewSignInMethod("google")).toBe(true);
    expect(isNewSignInMethod("password")).toBe(false);
  });

  it("requires a password change only for active, verified password accounts", () => {
    const expired = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-07-03T00:00:00Z");
    expect(needsPasswordChange("password", true, true, expired, now)).toBe(true);
    expect(needsPasswordChange(undefined, true, true, expired, now)).toBe(true);
    expect(needsPasswordChange("google", true, true, expired, now)).toBe(false);
    expect(needsPasswordChange("email_otp", true, true, expired, now)).toBe(false);
    expect(needsPasswordChange("password", false, true, expired, now)).toBe(false);
    expect(needsPasswordChange("password", true, false, expired, now)).toBe(false);
    expect(needsPasswordChange("password", true, true, now, expired)).toBe(false);
  });
});