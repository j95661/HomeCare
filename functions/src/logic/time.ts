export function zonedParts(now: Date, timeZone: string): { date: string; time: string } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(dtf.formatToParts(now).map((part) => [part.type, part.value]));
  let hour = parts.hour ?? "00";
  if (hour === "24") hour = "00";
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}`,
  };
}

export function minutesOf(hhmm: string): number {
  const [hour, minute] = hhmm.split(":").map((part) => Number(part));
  return hour * 60 + minute;
}

export function isWithinWindow(scheduled: string, current: string, windowMinutes: number): boolean {
  const diff = minutesOf(current) - minutesOf(scheduled);
  return diff >= 0 && diff < windowMinutes;
}
