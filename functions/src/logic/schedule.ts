export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export type ShiftTemplate = {
  id: string;
  userId: string;
  userName: string;
  weekday: number;
  start: string;
  end: string;
  effectiveFrom: string;
  effectiveUntil: string;
};

export type CoverageKind = "swap" | "day_off" | "sick_leave";

export type ShiftException = {
  id: string;
  date: string;
  templateId: string;
  kind: CoverageKind;
  userId: string;
  userName: string;
  start: string;
  end: string;
  requestId: string;
};

export type ResolvedShift = {
  id: string;
  templateId: string;
  exceptionId: string;
  userId: string;
  userName: string;
  date: string;
  start: string;
  end: string;
  source: "template" | "exception";
  kind: "" | CoverageKind;
};

export type PatternPromotion = {
  closeTemplateId: string;
  effectiveUntil: string;
  next: {
    userId: string;
    userName: string;
    weekday: number;
    start: string;
    end: string;
    effectiveFrom: string;
    effectiveUntil: string;
  };
};

export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Sunday is 0. Uses the UTC calendar date, matching the known Sunday 2026-10-04. */
export function weekdayOf(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function shiftKey(templateId: string, date: string): string {
  return `${templateId}_${date}`;
}

export function templateApplies(template: ShiftTemplate, date: string): boolean {
  if (template.weekday !== weekdayOf(date)) return false;
  if (date < template.effectiveFrom) return false;
  if (template.effectiveUntil !== "" && date >= template.effectiveUntil) return false;
  return true;
}

export function isOpenTemplate(template: { effectiveUntil: string }, today: string): boolean {
  return template.effectiveUntil === "" || template.effectiveUntil > today;
}

export function coverageKind(value: unknown): CoverageKind | "" {
  return value === "swap" || value === "day_off" || value === "sick_leave" ? value : "";
}

/** Time off and sick leave are not working shifts. */
export function isAwayKind(kind: string): boolean {
  return kind === "day_off" || kind === "sick_leave";
}

export function exceptionLabel(kind: "" | CoverageKind): string {
  if (kind === "day_off") return "Time off";
  if (kind === "sick_leave") return "Sick leave";
  if (kind === "swap") return "Swap";
  return "Exception";
}

export function coverageRequestLabel(type: string): string {
  if (type === "day_off") return "Time off";
  if (type === "sick_leave") return "Sick leave";
  return "Shift swap";
}

export function dayExceptionLabel(shifts: { source: string; kind: "" | CoverageKind }[]): string {
  const kinds = [...new Set(shifts.filter((shift) => shift.source === "exception").map((shift) => shift.kind))];
  if (kinds.length === 0) return "";
  if (kinds.length > 1) return "Exception";
  return exceptionLabel(kinds[0]);
}

export function templateFromData(id: string, data: Record<string, unknown>): ShiftTemplate {
  return {
    id,
    userId: String(data.userId ?? ""),
    userName: String(data.userName ?? ""),
    weekday: Number(data.weekday),
    start: String(data.start ?? ""),
    end: String(data.end ?? ""),
    effectiveFrom: String(data.effectiveFrom ?? ""),
    effectiveUntil: String(data.effectiveUntil ?? ""),
  };
}

export function exceptionFromData(id: string, data: Record<string, unknown>): ShiftException {
  const parsed = coverageKind(data.kind);
  const kind: CoverageKind = parsed === "" ? "swap" : parsed;
  return {
    id,
    date: String(data.date ?? ""),
    templateId: String(data.templateId ?? ""),
    kind,
    userId: String(data.userId ?? ""),
    userName: String(data.userName ?? ""),
    start: String(data.start ?? ""),
    end: String(data.end ?? ""),
    requestId: String(data.requestId ?? ""),
  };
}

export function resolveDay(date: string, templates: ShiftTemplate[], exceptions: ShiftException[]): ResolvedShift[] {
  const applicable = templates.filter((template) => templateApplies(template, date));
  const applicableIds = new Set(applicable.map((template) => template.id));
  const resolved: ResolvedShift[] = applicable.map((template) => {
    const exception = exceptions
      .filter((item) => item.templateId === template.id && item.date === date)
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    if (exception) {
      return {
        id: shiftKey(template.id, date),
        templateId: template.id,
        exceptionId: exception.id,
        userId: exception.userId,
        userName: exception.userName,
        date,
        start: exception.start || template.start,
        end: exception.end || template.end,
        source: "exception",
        kind: exception.kind,
      };
    }
    return {
      id: shiftKey(template.id, date),
      templateId: template.id,
      exceptionId: "",
      userId: template.userId,
      userName: template.userName,
      date,
      start: template.start,
      end: template.end,
      source: "template",
      kind: "",
    };
  });

  for (const exception of exceptions) {
    if (exception.date !== date || applicableIds.has(exception.templateId)) continue;
    resolved.push({
      id: exception.id || shiftKey(exception.templateId, date),
      templateId: exception.templateId,
      exceptionId: exception.id,
      userId: exception.userId,
      userName: exception.userName,
      date,
      start: exception.start,
      end: exception.end,
      source: "exception",
      kind: exception.kind,
    });
  }

  resolved.sort((a, b) => a.start.localeCompare(b.start) || a.userName.localeCompare(b.userName) || a.id.localeCompare(b.id));
  return resolved;
}

export function resolveRange(start: string, end: string, templates: ShiftTemplate[], exceptions: ShiftException[]): ResolvedShift[] {
  if (start > end) return [];
  const shifts: ResolvedShift[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    shifts.push(...resolveDay(cursor, templates, exceptions));
  }
  return shifts;
}

/** Accepting coverage writes one dated exception. It does not edit the weekly template. */
export function planCoverageWrite(input: {
  templateUserId: string;
  exceptionUserId: string | null;
  requesterId: string;
}): "create" | "update" {
  if (input.exceptionUserId !== null) {
    if (input.exceptionUserId !== input.requesterId) throw new Error("That shift has already changed.");
    return "update";
  }
  if (input.templateUserId !== input.requesterId) throw new Error("That shift has already changed.");
  return "create";
}

/**
 * Copy an accepted swap onto future weeks of that weekday.
 * The swap date stays an exception. Earlier weeks keep the previous person.
 */
export function promoteSwap(input: {
  template: ShiftTemplate;
  shiftDate: string;
  acceptorId: string;
  acceptorName: string;
  alreadyPromoted: boolean;
}): PatternPromotion {
  if (input.alreadyPromoted) throw new Error("That swap is already the weekly pattern.");
  if (!templateApplies(input.template, input.shiftDate)) {
    throw new Error("That weekly shift does not cover this date.");
  }
  const nextDate = addDays(input.shiftDate, 7);
  if (input.template.effectiveUntil !== "" && input.template.effectiveUntil <= nextDate) {
    throw new Error("That pattern already ends before the following week.");
  }
  return {
    closeTemplateId: input.template.id,
    effectiveUntil: nextDate,
    next: {
      userId: input.acceptorId,
      userName: input.acceptorName,
      weekday: input.template.weekday,
      start: input.template.start,
      end: input.template.end,
      effectiveFrom: nextDate,
      effectiveUntil: input.template.effectiveUntil,
    },
  };
}

/** True when this person is the one working and the clock is inside start inclusive, end exclusive. */
export function isDuringShift(
  time: string,
  shifts: { userId: string; start: string; end: string; kind: "" | CoverageKind }[],
  userId: string,
): boolean {
  return shifts.some(
    (shift) => shift.userId === userId && !isAwayKind(shift.kind) && shift.start <= time && time < shift.end,
  );
}

/**
 * Follow the schedule unless the person is holding the other status.
 * The hold clears once the schedule matches what they chose.
 */
export function planShiftSync(input: { onShift: boolean; shiftHold: boolean; scheduled: boolean }): {
  onShift: boolean;
  shiftHold: boolean;
  write: boolean;
} {
  if (input.shiftHold && input.scheduled === input.onShift) {
    return { onShift: input.onShift, shiftHold: false, write: true };
  }
  if (input.shiftHold) {
    return { onShift: input.onShift, shiftHold: true, write: false };
  }
  if (input.onShift !== input.scheduled) {
    return { onShift: input.scheduled, shiftHold: false, write: true };
  }
  return { onShift: input.onShift, shiftHold: false, write: false };
}
