import { zonedParts } from "./time";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function handoverNoteDay(note: { day?: string; createdAt?: Date | null }, timeZone: string): string {
  if (note.day && DAY.test(note.day)) return note.day;
  if (note.createdAt) return zonedParts(note.createdAt, timeZone).date;
  return "";
}

/** Notes from earlier days leave the home list and stay in the review log. */
export function shouldArchiveHandover(note: { day?: string; createdAt?: Date | null }, today: string, timeZone: string): boolean {
  const day = handoverNoteDay(note, timeZone);
  return day !== "" && day < today;
}
