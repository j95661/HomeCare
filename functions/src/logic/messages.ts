/** Keep this identical to messagePreview in src/media.ts. */
export function messagePreview(text: string, hasImage: boolean): string {
  const trimmed = text.trim();
  const value = trimmed || (hasImage ? "Picture" : "");
  return value.slice(0, 140);
}

export type CoverageNotice = {
  action: "requested" | "accepted" | "cancelled" | "covered";
  type: "swap" | "day_off" | "sick_leave";
  date: string;
  start: string;
  end: string;
  reason?: string;
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

function coveragePhrase(notice: CoverageNotice): string {
  if (notice.type === "day_off") {
    if (notice.action === "accepted") return "Approved the time off";
    if (notice.action === "cancelled") return "Cancelled the time off";
    if (notice.action === "covered") return "Offered to cover the time off";
    return "Requested time off";
  }
  if (notice.type === "sick_leave") {
    if (notice.action === "accepted") return "Approved the sick leave";
    if (notice.action === "cancelled") return "Cancelled the sick leave";
    if (notice.action === "covered") return "Offered to cover the sick leave";
    return "Requested sick leave";
  }
  if (notice.action === "accepted") return "Took the shift swap";
  if (notice.action === "cancelled") return "Cancelled the shift swap";
  return "Requested a shift swap";
}

function coverageReason(notice: CoverageNotice): string {
  const reason = notice.reason?.trim() ?? "";
  return reason ? ` Reason: ${reason}` : "";
}

/** An accepted or cancelled swap leaves the notice board. A cancellation always leaves it. */
export function coveragePinsNotice(notice: CoverageNotice): boolean {
  if (notice.action === "cancelled") return false;
  return !(notice.type === "swap" && notice.action === "accepted");
}

/** Care-team text for a shift swap, time off, or sick leave. */
export function coverageMessageText(notice: CoverageNotice): string {
  const when = `${formatDay(notice.date)}, ${formatClock(notice.start)}–${formatClock(notice.end)}`;
  return `${coveragePhrase(notice)} for ${when}.${coverageReason(notice)}`;
}

export function coverageWhen(notice: Pick<CoverageNotice, "date" | "start" | "end">): string {
  return `${formatDay(notice.date)}, ${formatClock(notice.start)}–${formatClock(notice.end)}`;
}

export function replaceParticipant(ids: string[], fromUid: string, toUid: string): string[] {
  return ids.map((id) => (id === fromUid ? toUid : id));
}
