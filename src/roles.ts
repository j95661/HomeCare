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

export function canManageGuides(role: Role): boolean {
  return canManageMeds(role);
}

export function canManageSchedule(role: Role): boolean {
  return role === "super_admin" || role === "admin" || role === "team_lead";
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
