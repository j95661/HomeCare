import { describe, expect, it } from "vitest";
import {
  canAssignRole,
  canDeleteActivities as serverCanDeleteActivities,
  canManageGuides as serverCanManageGuides,
  canManageMedications,
  canManageSchedule as serverCanManageSchedule,
  canReviewAllLogs,
  canRevoke,
  canClearUserEmoji as serverCanClearUserEmoji,
  canDeleteHandover as serverCanDeleteHandover,
  canDeleteMessage as serverCanDeleteMessage,
  isAccountEnabled as serverIsAccountEnabled,
  canPostCareTeamNotice as serverCanPostCareTeamNotice,
  canPostToCareTeam as serverCanPostToCareTeam,
  isCareStaff as serverIsCareStaff,
  canWriteSettings,
  isProtectedAccount,
  isRole,
  ROLES,
} from "../functions/src/logic/roles";
import {
  canClearUserEmoji,
  canDeleteHandover,
  canDeleteMessage,
  isAccountEnabled,
  canPostCareTeamNotice,
  canPostToCareTeam,
  isCareStaff,
  canDeleteActivities,
  canManageGuides,
  canManageMeds,
  canEditMedications,
  canEditWeeklyPattern,
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
      expect(canClearUserEmoji(role, "admin", "pat")).toBe(serverCanClearUserEmoji(role, "admin", "pat"));
      expect(isCareStaff(role)).toBe(serverIsCareStaff(role));
      expect(canPostToCareTeam(role)).toBe(serverCanPostToCareTeam(role));
      expect(canPostCareTeamNotice(role)).toBe(serverCanPostCareTeamNotice(role));
      expect(canDeleteHandover(role)).toBe(serverCanDeleteHandover(role));
      expect(canDeleteMessage(role, "a", "a")).toBe(serverCanDeleteMessage(role, "a", "a"));
      expect(canDeleteMessage(role, "a", "b")).toBe(serverCanDeleteMessage(role, "a", "b"));
    }
    expect(isAccountEnabled({})).toBe(serverIsAccountEnabled({}));
    expect(isAccountEnabled({ enabled: false })).toBe(serverIsAccountEnabled({ enabled: false }));
  });

  it("lets admins clear another person's emoji", () => {
    expect(canClearUserEmoji("super_admin", "super", "pat")).toBe(true);
    expect(canClearUserEmoji("admin", "admin", "pat")).toBe(true);
    expect(canClearUserEmoji("admin", "admin", "admin")).toBe(false);
    expect(canClearUserEmoji("team_lead", "lead", "pat")).toBe(false);
    expect(canClearUserEmoji("care_provider", "pat", "sam")).toBe(false);
    expect(canClearUserEmoji("admin", "admin", "")).toBe(false);
  });

  it("gives medication edits to admins, guide and schedule edits to team leads, and settings to the super admin", () => {
    expect(roles.filter(canManageMeds)).toEqual(["super_admin", "admin"]);
    expect(roles.filter(canEditMedications)).toEqual(["super_admin", "admin", "team_lead"]);
    expect(roles.filter(canManageGuides)).toEqual(["super_admin", "admin", "team_lead"]);
    expect(roles.filter(canManageSchedule)).toEqual(["super_admin", "admin", "team_lead"]);
    expect(roles.filter(canEditWeeklyPattern)).toEqual(["super_admin", "admin"]);
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

  it("lets the author or an admin delete a message, and keeps the care team to care staff", () => {
    expect(roles.filter(isCareStaff)).toEqual(["team_lead", "care_provider"]);
    expect(roles.filter(canPostToCareTeam)).toEqual(roles);
    expect(roles.filter(canPostCareTeamNotice)).toEqual(["super_admin", "admin", "team_lead"]);
    expect(roles.filter(canDeleteHandover)).toEqual(["super_admin", "admin", "team_lead"]);
    expect(canDeleteMessage("care_provider", "pat", "pat")).toBe(true);
    expect(canDeleteMessage("team_lead", "lead", "pat")).toBe(false);
    expect(canDeleteMessage("admin", "admin", "pat")).toBe(true);
    expect(canDeleteMessage("super_admin", "super", "pat")).toBe(true);
    expect(canDeleteMessage("admin", "admin", "")).toBe(false);
    expect(isAccountEnabled({})).toBe(true);
    expect(isAccountEnabled({ enabled: true })).toBe(true);
    expect(isAccountEnabled({ enabled: false })).toBe(false);
  });

  it("uses short labels on screen", () => {
    expect(roles.map(roleLabel)).toEqual(["Super admin", "Admin", "Team lead", "Care provider"]);
  });
});
