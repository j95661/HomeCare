import { isAwayKind } from "./schedule";

export const SHIFT_PERIODS = ["morning", "afternoon", "evening"] as const;

export type ShiftPeriod = (typeof SHIFT_PERIODS)[number];

/** Parts of the care day. A shift covers a part when the two windows overlap. */
export const PERIOD_HOURS: Record<ShiftPeriod, { start: string; end: string; label: string }> = {
  morning: { start: "05:00", end: "12:00", label: "Morning" },
  afternoon: { start: "12:00", end: "17:00", label: "Afternoon" },
  evening: { start: "17:00", end: "22:00", label: "Evening" },
};

export function isShiftPeriod(value: string): value is ShiftPeriod {
  return (SHIFT_PERIODS as readonly string[]).includes(value);
}

export function shiftCoversPeriod(start: string, end: string, period: ShiftPeriod): boolean {
  const window = PERIOD_HOURS[period];
  return start < window.end && end > window.start;
}

export function periodsForShifts(shifts: { start: string; end: string; kind: string }[]): ShiftPeriod[] {
  return SHIFT_PERIODS.filter((period) =>
    shifts.some((shift) => !isAwayKind(shift.kind) && shiftCoversPeriod(shift.start, shift.end, period)),
  );
}
