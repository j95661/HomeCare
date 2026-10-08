export type HomeMedFocus = {
  status: "due" | "next";
  id: string;
  name: string;
  time: string;
};

type MedInput = { id: string; name: string; times: string[] };
type LogInput = { medicationId?: string; scheduledTime: string; action: string };

/** The earliest unanswered dose at or before now, otherwise the next one. */
export function homeMedicationFocus(meds: MedInput[], logs: LogInput[], nowHHMM: string): HomeMedFocus[] {
  const open: { id: string; name: string; time: string }[] = [];
  for (const med of meds) {
    for (const time of med.times) {
      const answered = logs.some(
        (log) => log.medicationId === med.id && log.scheduledTime === time && log.action !== "snooze",
      );
      if (!answered && /^\d{2}:\d{2}$/.test(time)) open.push({ id: med.id, name: med.name, time });
    }
  }
  if (open.length === 0) return [];
  const dueTime = open
    .map((dose) => dose.time)
    .filter((time) => time <= nowHHMM)
    .sort()[0];
  const focusTime = dueTime ?? open.map((dose) => dose.time).sort()[0];
  const status = dueTime ? "due" : "next";
  return open
    .filter((dose) => dose.time === focusTime)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((dose) => ({ status, ...dose }));
}
