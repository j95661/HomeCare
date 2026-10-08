/** Keep this identical to messagePreview in src/media.ts. */
export function messagePreview(text: string, hasImage: boolean): string {
  const trimmed = text.trim();
  const value = trimmed || (hasImage ? "Picture" : "");
  return value.slice(0, 140);
}

export type CoverageNotice = {
  action: "requested" | "accepted" | "cancelled";
  type: "swap" | "day_off";
  date: string;
  start: string;
  end: string;
};

function formatDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatClock(hhmm: string): string {
  const [hourText, minute] = hhmm.split(":");
  const hour = Number(hourText);
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minute} ${suffix}`;
}

/** Care-team text for a shift swap or day off. */
export function coverageMessageText(notice: CoverageNotice): string {
  const when = `${formatDay(notice.date)}, ${formatClock(notice.start)}–${formatClock(notice.end)}`;
  const what = notice.type === "day_off" ? "day off" : "shift swap";
  if (notice.action === "accepted") return `Took the ${what} for ${when}.`;
  if (notice.action === "cancelled") return `Cancelled the ${what} for ${when}.`;
  return `Requested a ${what} for ${when}.`;
}

export function replaceParticipant(ids: string[], fromUid: string, toUid: string): string[] {
  return ids.map((id) => (id === fromUid ? toUid : id));
}
