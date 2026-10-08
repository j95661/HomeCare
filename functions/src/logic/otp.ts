import { createHash, timingSafeEqual } from "crypto";

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MIN_INTERVAL_MS = 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_SENDS_PER_HOUR = 5;

export type OtpChallenge = {
  hash: string;
  expiresAt: number;
  attempts: number;
  lastSentAt: number;
  hourlyCount: number;
  windowStart: number;
};

export function hashOtp(uid: string, code: string, pepper: string): string {
  return createHash("sha256").update(`${pepper}:${uid}:${code}`).digest("hex");
}

export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function normalizeOtp(code: string): string {
  return code.replace(/\s+/g, "");
}

export function canSendOtp(
  existing: OtpChallenge | null,
  now: number,
): { ok: true; hourlyCount: number; windowStart: number } | { ok: false; reason: string } {
  if (!existing) return { ok: true, hourlyCount: 1, windowStart: now };
  if (now - existing.lastSentAt < OTP_MIN_INTERVAL_MS) {
    return { ok: false, reason: "Wait a minute before requesting another code." };
  }
  const windowFresh = now - existing.windowStart >= 60 * 60 * 1000;
  const windowStart = windowFresh ? now : existing.windowStart;
  const hourlyCount = windowFresh ? 1 : existing.hourlyCount + 1;
  if (hourlyCount > OTP_MAX_SENDS_PER_HOUR) {
    return { ok: false, reason: "Too many codes were requested. Try again later." };
  }
  return { ok: true, hourlyCount, windowStart };
}

export function checkOtpCode(
  challenge: OtpChallenge,
  uid: string,
  code: string,
  now: number,
  pepper: string,
): { ok: true } | { ok: false; reason: string; attempts: number } {
  if (now > challenge.expiresAt) {
    return { ok: false, reason: "That code has expired. Request a new one.", attempts: challenge.attempts };
  }
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: "Too many tries. Request a new code.", attempts: challenge.attempts };
  }
  const hash = hashOtp(uid, code, pepper);
  if (!hashesMatch(hash, challenge.hash)) {
    return { ok: false, reason: "That code is not correct.", attempts: challenge.attempts + 1 };
  }
  return { ok: true };
}
