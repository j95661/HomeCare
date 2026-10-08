import type { Role } from "./types";

export function roleLabel(role: Role): string {
  switch (role) {
    case "super_admin":
      return "Super admin";
    case "admin":
      return "Admin";
    case "team_lead":
      return "Team lead";
    case "care_provider":
      return "Care provider";
  }
}

export function canManageMeds(role: Role): boolean {
  return role === "super_admin" || role === "admin";
}

/** Admins and team leads add and change medications. */
export function canEditMedications(role: Role): boolean {
  return role === "super_admin" || role === "admin" || role === "team_lead";
}

export function canManageGuides(role: Role): boolean {
  return role === "super_admin" || role === "admin" || role === "team_lead";
}

export function canManageSchedule(role: Role): boolean {
  return role === "super_admin" || role === "admin" || role === "team_lead";
}

/** Adding or rewriting the weekly pattern is an admin screen, not an employee screen. */
export function canEditWeeklyPattern(role: Role): boolean {
  return role === "super_admin" || role === "admin";
}

export function canReviewLogs(role: Role): boolean {
  return canManageSchedule(role);
}

export function canDeleteActivities(role: Role): boolean {
  return canManageMeds(role);
}

export function isSuperAdmin(role: Role): boolean {
  return role === "super_admin";
}

/** Admins can remove the emoji stored on someone else's profile. */
export function canClearUserEmoji(role: Role, callerUid: string, targetUid: string): boolean {
  if (role !== "super_admin" && role !== "admin") return false;
  return targetUid.length > 0 && callerUid !== targetUid;
}

/** Care team chat notifications go to care providers and team leads. */
export function isCareStaff(role: Role): boolean {
  return role === "team_lead" || role === "care_provider";
}

/** Anyone on the roster can write in the care team thread. */
export function canPostToCareTeam(role: Role): boolean {
  return role === "super_admin" || role === "admin" || role === "team_lead" || role === "care_provider";
}

/** A lead or parent message is also the Home notice. */
export function canPostCareTeamNotice(role: Role): boolean {
  return role === "super_admin" || role === "admin" || role === "team_lead";
}

/** Missing `enabled` means the account was created before the roster flag and can sign in. */
export function isAccountEnabled(user: { enabled?: boolean | null }): boolean {
  return user.enabled !== false;
}

/** Admins and team leads can remove a handover note from today's list. */
export function canDeleteHandover(role: Role): boolean {
  return role === "super_admin" || role === "admin" || role === "team_lead";
}

/** The author can delete their own message. An admin can delete any message they can open. */
export function canDeleteMessage(role: Role, callerUid: string, senderId: string): boolean {
  if (!senderId || !callerUid) return false;
  if (callerUid === senderId) return true;
  return role === "super_admin" || role === "admin";
}
