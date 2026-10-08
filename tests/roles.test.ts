import { describe, expect, it } from "vitest";
import {
  canAssignRole,
  canDeleteActivities as serverCanDeleteActivities,
  canManageGuides as serverCanManageGuides,
  canManageMedications,
  canManageSchedule as serverCanManageSchedule,
  canReviewAllLogs,
  canRevoke,
  canWriteSettings,
  isProtectedAccount,
  isRole,
  ROLES,
} from "../functions/src/logic/roles";
import {
  canDeleteActivities,
  canManageGuides,
  canManageMeds,
  canManageSchedule,
  canReviewLogs,
  isSuperAdmin,
  roleLabel,
} from "../src/roles";
import type { Role } from "../src/types";

const roles: Role[] = ["super_admin", "admin", "team_lead", "care_provider"];

describe("role capabilities", () => {
  it("lists the four roles and rejects anything else", () => {
    expect(ROLES).toEqual(roles);
    expect(isRole("team_lead")).toBe(true);
    expect(isRole("parent")).toBe(false);
    expect(isRole(null)).toBe(false);
  });

  it("matches the screen helpers to the server helpers", () => {
    for (const role of roles) {
      expect(canManageMeds(role)).toBe(canManageMedications(role));
      expect(canManageGuides(role)).toBe(serverCanManageGuides(role));
      expect(canManageSchedule(role)).toBe(serverCanManageSchedule(role));
      expect(canReviewLogs(role)).toBe(canReviewAllLogs(role));
      expect(canDeleteActivities(role)).toBe(serverCanDeleteActivities(role));
      expect(isSuperAdmin(role)).toBe(role === "super_admin");
    }
  });

  it("gives medication and guide edits to admins, schedule edits to team leads, and settings to the super admin", () => {
    expect(roles.filter(canManageMeds)).toEqual(["super_admin", "admin"]);
    expect(roles.filter(canManageGuides)).toEqual(["super_admin", "admin"]);
    expect(roles.filter(canManageSchedule)).toEqual(["super_admin", "admin", "team_lead"]);
    expect(roles.filter(canReviewLogs)).toEqual(["super_admin", "admin", "team_lead"]);
    expect(roles.filter(canDeleteActivities)).toEqual(["super_admin", "admin"]);
    expect(roles.filter((role) => canRevoke(role))).toEqual(["super_admin"]);
    expect(roles.filter((role) => canWriteSettings(role))).toEqual(["super_admin"]);
    expect(canAssignRole("super_admin", "team_lead")).toBe(true);
    expect(canAssignRole("super_admin", "super_admin")).toBe(false);
    expect(canAssignRole("admin", "care_provider")).toBe(false);
  });

  it("protects a super admin role and any account flagged protected", () => {
    expect(isProtectedAccount({ role: "super_admin" })).toBe(true);
    expect(isProtectedAccount({ role: "admin", protected: true })).toBe(true);
    expect(isProtectedAccount({ role: "care_provider", protected: false })).toBe(false);
  });

  it("uses short labels on screen", () => {
    expect(roles.map(roleLabel)).toEqual(["Super admin", "Admin", "Team lead", "Care provider"]);
  });
});
