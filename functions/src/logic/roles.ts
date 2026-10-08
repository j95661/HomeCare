export const ROLES = ["super_admin", "admin", "team_lead", "care_provider"] as const;
export type Role = (typeof ROLES)[number];

export const ASSIGNABLE_ROLES: Role[] = ["admin", "team_lead", "care_provider"];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function canRevoke(role: Role): boolean {
  return role === "super_admin";
}

export function isProtectedAccount(user: { role: Role; protected?: boolean }): boolean {
  return user.role === "super_admin" || user.protected === true;
}

export function canAssignRole(callerRole: Role, nextRole: Role): boolean {
  return callerRole === "super_admin" && nextRole !== "super_admin" && ASSIGNABLE_ROLES.includes(nextRole);
}

export function canManageMedications(role: Role): boolean {
  return role === "super_admin" || role === "admin";
}

export function canManageGuides(role: Role): boolean {
  return role === "super_admin" || role === "admin";
}

export function canManageSchedule(role: Role): boolean {
  return role === "super_admin" || role === "admin" || role === "team_lead";
}

export function canReviewAllLogs(role: Role): boolean {
  return canManageSchedule(role);
}

export function canDeleteActivities(role: Role): boolean {
  return role === "super_admin" || role === "admin";
}

export function canWriteSettings(role: Role): boolean {
  return role === "super_admin";
}

/** Admins can remove the emoji stored on someone else's profile. */
export function canClearUserEmoji(role: Role, callerUid: string, targetUid: string): boolean {
  if (role !== "super_admin" && role !== "admin") return false;
  return targetUid.length > 0 && callerUid !== targetUid;
}

/** Care team messages are posted and delivered to these roles. */
export function isCareStaff(role: Role): boolean {
  return role === "team_lead" || role === "care_provider";
}

/** Missing `enabled` means the account was created before the roster flag and can sign in. */
export function isAccountEnabled(user: { enabled?: boolean | null }): boolean {
  return user.enabled !== false;
}

/** The author can delete their own message. An admin can delete any message they can open. */
export function canDeleteMessage(role: Role, callerUid: string, senderId: string): boolean {
  if (!senderId || !callerUid) return false;
  if (callerUid === senderId) return true;
  return role === "super_admin" || role === "admin";
}
