import { zonedParts } from "./time";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function handoverNoteDay(
  note: { day?: string; createdAt?: { toDate: () => Date } | Date | null },
  timeZone: string,
): string {
  if (note.day && DAY.test(note.day)) return note.day;
  const created =
    note.createdAt && typeof note.createdAt === "object" && "toDate" in note.createdAt
      ? note.createdAt.toDate()
      : note.createdAt instanceof Date
        ? note.createdAt
        : null;
  if (!created) return "";
  return zonedParts(created, timeZone).date;
}

export function isTodaysHandover(
  note: { day?: string; createdAt?: { toDate: () => Date } | Date | null },
  today: string,
  timeZone: string,
): boolean {
  return handoverNoteDay(note, timeZone) === today;
}
