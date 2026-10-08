export const MED_ACTIONS = ["given", "declined", "missed", "snooze"] as const;
export type MedAction = (typeof MED_ACTIONS)[number];

const ACTION_ID = /^[A-Za-z0-9_-]{8,80}$/;
const EARLIEST = Date.UTC(2020, 0, 1);
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

export function normalizeActionId(raw: unknown): string | null {
  const id = String(raw ?? "").trim();
  return ACTION_ID.test(id) ? id : null;
}

export function isMedAction(value: string): value is MedAction {
  return (MED_ACTIONS as readonly string[]).includes(value);
}

/** Keep the device time when it is a real timestamp. Otherwise use the server clock. */
export function deviceActedAt(raw: unknown, now: number): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return now;
  const ms = Math.floor(value);
  if (ms < EARLIEST || ms > now + FUTURE_SLACK_MS) return now;
  return ms;
}
