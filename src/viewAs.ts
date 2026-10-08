import type { Role, Session } from "./types";

export const VIEW_CHANGE = "Switch back to your own account to make changes.";

export type ViewIdentity = {
  uid: string;
  displayName: string;
  role: Role;
  emoji: string;
  onShift: boolean;
  colorScheme: string;
};

const ROLES = new Set<Role>(["super_admin", "admin", "team_lead", "care_provider"]);

export function isViewRole(value: unknown): value is Role {
  return typeof value === "string" && ROLES.has(value as Role);
}

/** Admins can open another person's screen, then switch back. */
export function canViewAsEmployee(role: Role): boolean {
  return role === "super_admin" || role === "admin";
}

/** The screen identity while an admin is looking through someone else's account. */
export function displaySession<T extends Session>(account: T, view: ViewIdentity | null): T & { viewingAs: boolean } {
  if (!view) return { ...account, viewingAs: false };
  return {
    ...account,
    uid: view.uid,
    displayName: view.displayName,
    role: view.role,
    emoji: view.emoji,
    onShift: view.onShift,
    personalColorScheme: view.colorScheme,
    viewingAs: true,
  };
}

let viewOnly = false;
let actingUid = "";

export const COVERAGE_ACT_CALLS = new Set(["requestShiftCoverage", "acceptShiftRequest", "cancelShiftRequest"]);

export function setViewOnly(on: boolean) {
  viewOnly = on;
}

export function setActingUid(uid: string) {
  actingUid = uid;
}

export function actingAsUid(): string {
  return actingUid;
}

export function viewOnlyError(): string | null {
  return viewOnly ? VIEW_CHANGE : null;
}

/** Swap and time off run as the employee an admin is acting as. */
export function withActingEmployee(name: string, data: object | undefined, uid: string): object {
  const payload = { ...(data ?? {}) };
  if (uid && COVERAGE_ACT_CALLS.has(name)) return { ...payload, asUid: uid };
  return payload;
}
