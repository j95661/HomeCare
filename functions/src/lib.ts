import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { coverageReplyHours } from "./logic/coverage";
import { DEFAULT_TIMEZONE } from "./logic/password";
import { isRole, type Role } from "./logic/roles";
import { normalizeSignIn, type SignInMethod } from "./logic/signin";
import { DEFAULT_COLOR_SCHEME, isColorScheme, normalizePersonalColorScheme, type ColorSchemeId } from "./logic/themes";
import { isAccountEnabled } from "./logic/roles";

if (getApps().length === 0) initializeApp();

export const db = getFirestore();
export const auth = getAuth();
export const messaging = getMessaging();

export type UserRecordData = {
  email: string;
  displayName: string;
  role: Role;
  signIn: SignInMethod;
  emoji: string;
  colorScheme: string;
  active: boolean;
  enabled: boolean;
  awaitingGoogle: boolean;
  protected: boolean;
  otpVerified: boolean;
  onShift: boolean;
  passwordChangedAt: Timestamp;
  passwordExpiresAt: Timestamp;
  createdBy: string;
};

export type AppSettings = {
  passwordMaxAgeDays: number;
  timezone: string;
  snoozeMinutes: number;
  coverageReplyHours: number;
  colorScheme: ColorSchemeId;
  superAdminEmail: string;
  superAdminUid: string;
};

export function requireAuth(request: CallableRequest): string {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  return request.auth.uid;
}

export async function readSettings(store: Firestore = db): Promise<AppSettings> {
  const snap = await store.doc("settings/app").get();
  if (!snap.exists) throw new HttpsError("failed-precondition", "App settings are not set up yet.");
  const data = snap.data() ?? {};
  return {
    passwordMaxAgeDays: Number(data.passwordMaxAgeDays),
    timezone: String(data.timezone || DEFAULT_TIMEZONE),
    snoozeMinutes: Number(data.snoozeMinutes || 10),
    coverageReplyHours: coverageReplyHours(data.coverageReplyHours),
    colorScheme: isColorScheme(data.colorScheme) ? data.colorScheme : DEFAULT_COLOR_SCHEME,
    superAdminEmail: String(data.superAdminEmail || ""),
    superAdminUid: String(data.superAdminUid || ""),
  };
}

export async function readProfile(uid: string, store: Firestore = db): Promise<UserRecordData & { uid: string }> {
  const snap = await store.doc(`users/${uid}`).get();
  if (!snap.exists) throw new HttpsError("permission-denied", "No profile for this account.");
  const data = snap.data() ?? {};
  if (!isRole(data.role)) throw new HttpsError("failed-precondition", "This account has no role.");
  const personalScheme = normalizePersonalColorScheme(data.colorScheme);
  return {
    uid,
    email: String(data.email || ""),
    displayName: String(data.displayName || ""),
    role: data.role,
    signIn: normalizeSignIn(data.signIn),
    emoji: String(data.emoji || ""),
    colorScheme: personalScheme.ok ? personalScheme.colorScheme : "",
    active: data.active === true,
    enabled: isAccountEnabled({ enabled: data.enabled as boolean | undefined }),
    awaitingGoogle: data.awaitingGoogle === true,
    protected: data.protected === true,
    otpVerified: data.otpVerified === true,
    onShift: data.onShift === true,
    passwordChangedAt: data.passwordChangedAt as Timestamp,
    passwordExpiresAt: data.passwordExpiresAt as Timestamp,
    createdBy: String(data.createdBy || ""),
  };
}

export async function requireReadyUser(uid: string): Promise<UserRecordData & { uid: string }> {
  const profile = await readProfile(uid);
  if (!profile.enabled) {
    throw new HttpsError("permission-denied", "This account is not enabled yet.");
  }
  const record = await auth.getUser(uid);
  if (record.disabled || !profile.active) {
    throw new HttpsError("permission-denied", "This account has been revoked.");
  }
  if (!profile.otpVerified) {
    throw new HttpsError("failed-precondition", "Verify the email code before continuing.");
  }
  return profile;
}

export function pepper(): string {
  const value = process.env.OTP_PEPPER;
  if (value) return value;
  if (process.env.FUNCTIONS_EMULATOR === "true") return "emulator-pepper";
  throw new HttpsError("failed-precondition", "Email verification is not configured on the server.");
}

export function isEmulator(): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true";
}

export { FieldValue, Timestamp };
