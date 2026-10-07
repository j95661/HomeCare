import { describe, expect, it } from "vitest";
import {
  canSendOtp,
  checkOtpCode,
  hashOtp,
  hashesMatch,
  normalizeOtp,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_HOUR,
  OTP_MIN_INTERVAL_MS,
  OTP_TTL_MS,
  type OtpChallenge,
} from "../functions/src/logic/otp";

const now = 1_700_000_000_000;
const pepper = "test-pepper";

function challenge(overrides: Partial<OtpChallenge> = {}): OtpChallenge {
  return {
    hash: hashOtp("pat", "123456", pepper),
    expiresAt: now + OTP_TTL_MS,
    attempts: 0,
    lastSentAt: now,
    hourlyCount: 1,
    windowStart: now,
    ...overrides,
  };
}

describe("email OTP", () => {
  it("hashes the code with the user and pepper, and ignores surrounding spaces", () => {
    expect(normalizeOtp(" 123 456 ")).toBe("123456");
    expect(hashOtp("pat", "123456", pepper)).not.toBe(hashOtp("sam", "123456", pepper));
    expect(hashOtp("pat", "123456", pepper)).not.toBe(hashOtp("pat", "123456", "other"));
    expect(hashesMatch(hashOtp("pat", "123456", pepper), hashOtp("pat", "123456", pepper))).toBe(true);
    expect(hashesMatch("abc", "abcd")).toBe(false);
  });

  it("accepts the code inside the ten-minute window and counts a wrong guess", () => {
    const current = challenge();
    expect(checkOtpCode(current, "pat", "123456", now + 1000, pepper)).toEqual({ ok: true });
    expect(checkOtpCode(current, "pat", "000000", now + 1000, pepper)).toEqual({
      ok: false,
      reason: "That code is not correct.",
      attempts: 1,
    });
    expect(checkOtpCode(current, "pat", "123456", now + OTP_TTL_MS + 1, pepper)).toMatchObject({
      ok: false,
      reason: "That code has expired. Request a new one.",
      attempts: 0,
    });
  });

  it("locks the code after five wrong tries", () => {
    const locked = challenge({ attempts: OTP_MAX_ATTEMPTS });
    expect(checkOtpCode(locked, "pat", "123456", now + 1000, pepper)).toMatchObject({
      ok: false,
      reason: "Too many tries. Request a new code.",
      attempts: OTP_MAX_ATTEMPTS,
    });
  });

  it("waits a minute between sends and allows five codes per hour", () => {
    expect(canSendOtp(null, now)).toEqual({ ok: true, hourlyCount: 1, windowStart: now });
    expect(canSendOtp(challenge(), now + OTP_MIN_INTERVAL_MS - 1)).toMatchObject({
      ok: false,
      reason: "Wait a minute before requesting another code.",
    });

    const fifth = canSendOtp(challenge({ hourlyCount: 4, lastSentAt: now }), now + OTP_MIN_INTERVAL_MS);
    expect(fifth).toEqual({ ok: true, hourlyCount: 5, windowStart: now });
    expect(canSendOtp(challenge({ hourlyCount: OTP_MAX_SENDS_PER_HOUR, lastSentAt: now }), now + OTP_MIN_INTERVAL_MS)).toMatchObject({
      ok: false,
      reason: "Too many codes were requested. Try again later.",
    });
  });

  it("starts a fresh hourly window an hour after the first send", () => {
    const later = now + 60 * 60 * 1000;
    expect(canSendOtp(challenge({ hourlyCount: OTP_MAX_SENDS_PER_HOUR, lastSentAt: later - OTP_MIN_INTERVAL_MS }), later)).toEqual({
      ok: true,
      hourlyCount: 1,
      windowStart: later,
    });
  });
});
