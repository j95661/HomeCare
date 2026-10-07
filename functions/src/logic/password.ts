const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_PASSWORD_MAX_AGE_DAYS = 183;

export function validatePassword(password: string): string | null {
  if (password.length < 8) return "Use at least 8 characters.";
  if (password.length > 200) return "That password is too long.";
  if (!/[A-Za-z]/.test(password)) return "Include a letter.";
  if (!/[0-9]/.test(password)) return "Include a number.";
  return null;
}

export function expiresAt(changedAt: Date, maxAgeDays: number): Date {
  if (!Number.isInteger(maxAgeDays) || maxAgeDays < 1 || maxAgeDays > 730) {
    throw new Error("Password interval must be a whole number of days from 1 to 730.");
  }
  return new Date(changedAt.getTime() + maxAgeDays * DAY_MS);
}

export function isPasswordExpired(expires: Date, now: Date): boolean {
  return now.getTime() >= expires.getTime();
}

export function assertTimezone(timeZone: string): void {
  if (!timeZone || timeZone.length > 80) throw new Error("Choose a timezone.");
  Intl.DateTimeFormat("en-US", { timeZone });
}
