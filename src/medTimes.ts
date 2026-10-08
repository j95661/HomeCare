/** Common dose times shown as 8:00 AM, 12:00 PM, 4:00 PM, and 8:00 PM. */
export const MED_TIME_CHOICES = ["08:00", "12:00", "16:00", "20:00"] as const;

export const MAX_MED_TIMES = 6;

export function isClockTime(value: string): boolean {
  return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
}

/** A clock control may include seconds. Keep hours and minutes. */
export function normalizeClockTime(value: string): string {
  const match = /^(\d{2}:\d{2})/.exec(value.trim());
  return match && isClockTime(match[1]) ? match[1] : "";
}

export function withMedTime(times: string[], time: string): { times: string[]; error: string } {
  const next = normalizeClockTime(time);
  if (!next) return { times, error: "Choose a time." };
  if (times.includes(next)) return { times: times.slice().sort(), error: "" };
  if (times.length >= MAX_MED_TIMES) return { times, error: "A medication can have up to 6 times." };
  return { times: [...times, next].sort(), error: "" };
}

export function withoutMedTime(times: string[], time: string): string[] {
  return times.filter((item) => item !== time);
}
