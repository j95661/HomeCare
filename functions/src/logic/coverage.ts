import { isAwayKind, type CoverageKind } from "./schedule";

export const DEFAULT_COVERAGE_REPLY_HOURS = 24;

export function coverageReplyHours(raw: unknown): number {
  const hours = Number(raw);
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) return DEFAULT_COVERAGE_REPLY_HOURS;
  return hours;
}

export function replyDeadline(now: Date, hours: number): Date {
  return new Date(now.getTime() + coverageReplyHours(hours) * 60 * 60 * 1000);
}

export type CoverageReply = {
  type: string;
  status: string;
  replyBy: Date | null;
  coverBy: string;
};

/** Time off and sick leave return to the employee when the team window closes with no offer to cover. */
export function shouldReturnUnanswered(request: CoverageReply, now: Date): boolean {
  if (!isAwayKind(request.type as CoverageKind)) return false;
  if (request.status !== "pending") return false;
  if (request.coverBy) return false;
  if (!request.replyBy || Number.isNaN(request.replyBy.getTime())) return false;
  return request.replyBy.getTime() <= now.getTime();
}

export function unansweredReplyText(type: CoverageKind, when: string): string {
  const label = type === "sick_leave" ? "sick leave" : "time off";
  return `Nobody responded to your ${label} for ${when}. It is back with you, waiting for an admin to approve.`;
}

export function adminReviewText(type: CoverageKind, requesterName: string, when: string, coveredBy: string): string {
  const label = type === "sick_leave" ? "sick leave" : "time off";
  if (coveredBy) return `${coveredBy} offered to cover ${requesterName}'s ${label} for ${when}. Please approve it.`;
  return `${requesterName} requested ${label} for ${when}. Nobody on the team responded. Please approve it.`;
}
