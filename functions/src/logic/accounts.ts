import { canAssignRole, canRevoke, isProtectedAccount, type Role } from "./roles";
import type { SignInMethod } from "./signin";

export class AuthzError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthzError";
  }
}

export type AccountProfile = {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  active: boolean;
  protected: boolean;
  otpVerified: boolean;
};

export type RevokeDeps = {
  disableAuth: (uid: string) => Promise<void>;
  revokeTokens: (uid: string) => Promise<void>;
  markInactive: (uid: string, by: string) => Promise<void>;
  setClaims: (uid: string, role: Role, active: boolean) => Promise<void>;
  listTokens: (uid: string) => Promise<string[]>;
  unsubscribe: (tokens: string[], uid: string) => Promise<void>;
  deleteTokens: (uid: string) => Promise<void>;
};

export type DeleteDeps = {
  removeProfile: (uid: string) => Promise<void>;
  removeAuth: (uid: string) => Promise<void>;
  removeInvite: (email: string, uid: string) => Promise<void>;
  removeSchedule: (uid: string) => Promise<void>;
  removeDevices: (uid: string) => Promise<void>;
};

export async function deleteAccount(deps: DeleteDeps, caller: AccountProfile, target: AccountProfile): Promise<void> {
  if (!caller.active || !caller.otpVerified) throw new AuthzError("Account is not active.");
  if (!canRevoke(caller.role)) throw new AuthzError("Only the super admin can delete a person.");
  if (isProtectedAccount(target)) throw new AuthzError("The super admin cannot be deleted.");
  if (caller.uid === target.uid) throw new AuthzError("You cannot delete your own account.");

  await deps.removeProfile(target.uid);
  await deps.removeAuth(target.uid);
  await deps.removeInvite(target.email, target.uid);
  await deps.removeSchedule(target.uid);
  await deps.removeDevices(target.uid);
}

export async function revokeAccount(
  deps: RevokeDeps,
  caller: AccountProfile,
  target: AccountProfile,
): Promise<void> {
  if (!caller.active || !caller.otpVerified) throw new AuthzError("Account is not active.");
  if (!canRevoke(caller.role)) throw new AuthzError("Only the super admin can revoke users.");
  if (isProtectedAccount(target)) throw new AuthzError("The super admin cannot be revoked.");
  if (caller.uid === target.uid) throw new AuthzError("You cannot revoke your own account.");

  // Firestore first so a still-valid ID token fails security rules immediately.
  await deps.markInactive(target.uid, caller.uid);
  await deps.setClaims(target.uid, target.role, false);
  await deps.disableAuth(target.uid);
  await deps.revokeTokens(target.uid);
  const tokens = await deps.listTokens(target.uid);
  await deps.unsubscribe(tokens, target.uid);
  await deps.deleteTokens(target.uid);
}

export function assertCanAssign(caller: AccountProfile, nextRole: Role, targetEmail: string, superAdminEmail: string): void {
  if (!caller.active || !caller.otpVerified) throw new AuthzError("Account is not active.");
  if (!canAssignRole(caller.role, nextRole)) throw new AuthzError("Only the super admin can assign that role.");
  if (targetEmail.toLowerCase() === superAdminEmail.toLowerCase()) {
    throw new AuthzError("That email is reserved for the super admin.");
  }
}

export function isAccountEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200;
}

export type EmailUpdatePlan = {
  email: string;
  changed: boolean;
  clearVerification: boolean;
};

/** A changed address is saved on the profile. Email-code accounts must verify the new inbox. */
export function planEmailUpdate(input: {
  currentEmail: string;
  nextEmail: string;
  signIn: SignInMethod;
  protectedAccount: boolean;
  superAdminEmail: string;
}): EmailUpdatePlan {
  const email = input.nextEmail.trim().toLowerCase();
  const current = input.currentEmail.trim().toLowerCase();
  if (email === current) return { email: current, changed: false, clearVerification: false };
  if (input.protectedAccount) throw new AuthzError("The super admin email cannot be changed.");
  if (!isAccountEmail(email)) throw new AuthzError("Enter a valid email.");
  if (email === input.superAdminEmail.trim().toLowerCase()) {
    throw new AuthzError("That email is reserved for the super admin.");
  }
  return { email, changed: true, clearVerification: input.signIn === "email_otp" };
}

export function assertCanEdit(
  caller: AccountProfile,
  target: AccountProfile,
  nextRole: Role | null,
): void {
  if (!caller.active || !caller.otpVerified) throw new AuthzError("Account is not active.");
  if (caller.role !== "super_admin") throw new AuthzError("Only the super admin can edit accounts.");
  if (isProtectedAccount(target) && nextRole && nextRole !== "super_admin") {
    throw new AuthzError("The super admin cannot be demoted.");
  }
  if (nextRole === "super_admin" && !isProtectedAccount(target)) {
    throw new AuthzError("There can be only one super admin.");
  }
}
