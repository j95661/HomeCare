import { createHash, randomInt } from "crypto";
import { logger } from "firebase-functions";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  auth,
  db,
  isEmulator,
  messaging,
  pepper,
  readProfile,
  readSettings,
  requireAuth,
  requireReadyUser,
} from "./lib";
import { sendOtpEmail } from "./email";
import { sendVisiblePush, unsubscribeTokens } from "./notify";
import { assertCanAssign, assertCanEdit, AuthzError, revokeAccount } from "./logic/accounts";
import { OTP_TTL_MS, canSendOtp, checkOtpCode, hashOtp, normalizeOtp, type OtpChallenge } from "./logic/otp";
import { assertTimezone, expiresAt, validatePassword } from "./logic/password";
import { isNewSignInMethod, needsPasswordChange, normalizeSignIn } from "./logic/signin";
import { isColorScheme } from "./logic/themes";
import { isRole, type Role } from "./logic/roles";
import { selectMedicationDispatches, type PendingSnooze, type ReminderMed, type ReminderUser } from "./logic/reminders";
import { applyAcceptance, type ShiftRecord, type ShiftRequestRecord } from "./logic/shifts";
import { zonedParts } from "./logic/time";

const callable = { invoker: "public" as const };

function asObject(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") return {};
  return data as Record<string, unknown>;
}

function authz(error: unknown): never {
  if (error instanceof AuthzError) throw new HttpsError("permission-denied", error.message);
  throw error;
}

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200;
}

async function stampPassword(uid: string, when: Date, maxAgeDays: number): Promise<void> {
  await db.doc(`users/${uid}`).update({
    passwordChangedAt: Timestamp.fromDate(when),
    passwordExpiresAt: Timestamp.fromDate(expiresAt(when, maxAgeDays)),
  });
}

async function verifyCurrentPassword(email: string, password: string): Promise<void> {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const apiKey = process.env.HOMECARE_WEB_API_KEY || process.env.FIREBASE_WEB_API_KEY || "demo-api-key";
  const url = host
    ? `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`
    : `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: false }),
  });
  if (!response.ok) throw new HttpsError("invalid-argument", "Current password is wrong.");
}

export const getSessionState = onCall(callable, async (request) => {
  const uid = requireAuth(request);
  const profile = await readProfile(uid);
  const record = await auth.getUser(uid);
  const settings = await readSettings();
  const expires = profile.passwordExpiresAt?.toDate?.() ?? new Date(0);
  const active = profile.active === true && !record.disabled;
  return {
    active,
    otpVerified: profile.otpVerified,
    role: profile.role,
    displayName: profile.displayName,
    email: profile.email,
    onShift: profile.onShift,
    signIn: profile.signIn,
    passwordChangeRequired: needsPasswordChange(profile.signIn, active, profile.otpVerified, expires, new Date()),
    passwordMaxAgeDays: settings.passwordMaxAgeDays,
    timezone: settings.timezone,
    snoozeMinutes: settings.snoozeMinutes,
    colorScheme: settings.colorScheme,
  };
});

export const requestEmailOtp = onCall(callable, async (request) => {
  const uid = requireAuth(request);
  const profile = await readProfile(uid);
  const record = await auth.getUser(uid);
  if (record.disabled || !profile.active) {
    throw new HttpsError("permission-denied", "This account has been revoked.");
  }
  if (profile.otpVerified) throw new HttpsError("failed-precondition", "This email is already verified.");

  return issueSignInCode(uid, profile.email);
});

export const verifyEmailOtp = onCall(callable, async (request) => {
  const uid = requireAuth(request);
  const profile = await readProfile(uid);
  const record = await auth.getUser(uid);
  if (record.disabled || !profile.active) {
    throw new HttpsError("permission-denied", "This account has been revoked.");
  }
  if (profile.otpVerified) return { verified: true };

  const code = normalizeOtp(String(asObject(request.data).code ?? ""));
  if (!/^\d{6}$/.test(code)) throw new HttpsError("invalid-argument", "Enter the 6-digit code.");
  const ref = db.doc(`private/otp/challenges/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("failed-precondition", "Request a code first.");
  const challenge = snap.data() as OtpChallenge;
  const result = checkOtpCode(challenge, uid, code, Date.now(), pepper());
  if (!result.ok) {
    await ref.update({ attempts: result.attempts });
    throw new HttpsError("invalid-argument", result.reason);
  }
  await db.doc(`users/${uid}`).update({ otpVerified: true });
  await auth.updateUser(uid, { emailVerified: true });
  await auth.setCustomUserClaims(uid, { role: profile.role, active: true, otpVerified: true });
  await ref.delete();
  return { verified: true };
});

export const changePassword = onCall(callable, async (request) => {
  const uid = requireAuth(request);
  const profile = await readProfile(uid);
  const record = await auth.getUser(uid);
  if (record.disabled || !profile.active) {
    throw new HttpsError("permission-denied", "This account has been revoked.");
  }
  if (!profile.otpVerified) throw new HttpsError("failed-precondition", "Verify the email code first.");
  if (normalizeSignIn(profile.signIn) !== "password") {
    throw new HttpsError("failed-precondition", "This account signs in without a password.");
  }
  const body = asObject(request.data);
  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");
  const problem = validatePassword(newPassword);
  if (problem) throw new HttpsError("invalid-argument", problem);
  if (currentPassword === newPassword) {
    throw new HttpsError("invalid-argument", "Choose a different password.");
  }
  await verifyCurrentPassword(profile.email, currentPassword);
  const settings = await readSettings();
  await auth.updateUser(uid, { password: newPassword });
  await auth.revokeRefreshTokens(uid);
  await stampPassword(uid, new Date(), settings.passwordMaxAgeDays);
  return { updated: true };
});

async function issueSignInCode(uid: string, email: string): Promise<{ sent: true; devCode?: string }> {
  const ref = db.doc(`private/otp/challenges/${uid}`);
  const existingSnap = await ref.get();
  const existing = existingSnap.exists ? (existingSnap.data() as OtpChallenge) : null;
  const now = Date.now();
  const gate = canSendOtp(existing, now);
  if (!gate.ok) throw new HttpsError("resource-exhausted", gate.reason);

  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  await ref.set({
    hash: hashOtp(uid, code, pepper()),
    expiresAt: now + OTP_TTL_MS,
    attempts: 0,
    lastSentAt: now,
    hourlyCount: gate.hourlyCount,
    windowStart: gate.windowStart,
  });
  await sendOtpEmail(email, code);
  return isEmulator() ? { sent: true, devCode: code } : { sent: true };
}

async function assertEmailFree(email: string): Promise<void> {
  try {
    await auth.getUserByEmail(email);
    throw new HttpsError("already-exists", "That email already has an account.");
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    const code = (error as { code?: string }).code;
    if (code !== "auth/user-not-found") throw error;
  }
  const users = await db.collection("users").where("email", "==", email).limit(1).get();
  if (!users.empty) throw new HttpsError("already-exists", "That email already has an account.");
  const invite = await db.doc(`invites/${email}`).get();
  if (invite.exists) throw new HttpsError("already-exists", "That email already has an invite.");
}

async function emailCodeAccount(email: string): Promise<{ uid: string; role: Role }> {
  if (!validEmail(email)) throw new HttpsError("invalid-argument", "Enter a valid email.");
  let record: { uid: string; disabled: boolean };
  try {
    record = await auth.getUserByEmail(email);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "auth/user-not-found") {
      throw new HttpsError("not-found", "That email is not set up for a sign-in code.");
    }
    throw error;
  }
  const snap = await db.doc(`users/${record.uid}`).get();
  if (!snap.exists || snap.get("signIn") !== "email_otp") {
    throw new HttpsError("not-found", "That email is not set up for a sign-in code.");
  }
  if (record.disabled || snap.get("active") !== true) {
    throw new HttpsError("permission-denied", "This account has been revoked.");
  }
  const role = snap.get("role");
  if (!isRole(role)) throw new HttpsError("failed-precondition", "This account has no role.");
  return { uid: record.uid, role };
}

export const createUserAccount = onCall(callable, async (request) => {
  const caller = await requireReadyUser(requireAuth(request));
  const body = asObject(request.data);
  const email = String(body.email ?? "").trim().toLowerCase();
  const displayName = String(body.displayName ?? "").trim();
  const signIn = body.signIn;
  const role = body.role;
  if (!validEmail(email)) throw new HttpsError("invalid-argument", "Enter a valid email.");
  if (displayName.length < 1 || displayName.length > 80) {
    throw new HttpsError("invalid-argument", "Enter a name.");
  }
  if (!isNewSignInMethod(signIn)) {
    throw new HttpsError("invalid-argument", "Choose Gmail or an email code.");
  }
  if (!isRole(role)) throw new HttpsError("invalid-argument", "Choose a role.");
  const settings = await readSettings();
  try {
    assertCanAssign(caller, role, email, settings.superAdminEmail);
  } catch (error) {
    authz(error);
  }
  await assertEmailFree(email);
  if (signIn === "google") {
    await db.doc(`invites/${email}`).set({
      email,
      displayName,
      role,
      signIn: "google",
      createdBy: caller.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { invited: true };
  }
  let created: { uid: string };
  try {
    created = await auth.createUser({ email, displayName, disabled: false });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "That email already has an account.");
    }
    throw error;
  }
  const now = new Date();
  await db.doc(`users/${created.uid}`).set({
    email,
    displayName,
    role,
    signIn: "email_otp",
    active: true,
    protected: false,
    otpVerified: false,
    onShift: false,
    passwordChangedAt: Timestamp.fromDate(now),
    passwordExpiresAt: Timestamp.fromDate(expiresAt(now, settings.passwordMaxAgeDays)),
    createdAt: FieldValue.serverTimestamp(),
    createdBy: caller.uid,
  });
  await auth.setCustomUserClaims(created.uid, { role, active: true, otpVerified: false });
  return { uid: created.uid };
});

export const removeInvite = onCall(callable, async (request) => {
  const caller = await requireReadyUser(requireAuth(request));
  if (caller.role !== "super_admin" || !caller.protected) {
    throw new HttpsError("permission-denied", "Only the super admin can remove an invite.");
  }
  const email = String(asObject(request.data).email ?? "").trim().toLowerCase();
  if (!validEmail(email)) throw new HttpsError("invalid-argument", "Choose an invite.");
  const ref = db.doc(`invites/${email}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "That invite was not found.");
  await ref.delete();
  return { removed: true };
});

export const acceptGoogleSignIn = onCall(callable, async (request) => {
  const uid = requireAuth(request);
  const record = await auth.getUser(uid);
  const email = String(record.email || "").trim().toLowerCase();
  const google = record.providerData.some((provider) => provider.providerId === "google.com");
  if (!google || !email || record.emailVerified !== true) {
    throw new HttpsError("failed-precondition", "Sign in with Gmail to join.");
  }
  const userRef = db.doc(`users/${uid}`);
  const inviteRef = db.doc(`invites/${email}`);
  const joined = await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (userSnap.exists) {
      if (userSnap.get("active") !== true) {
        throw new HttpsError("permission-denied", "This account has been revoked.");
      }
      return { role: String(userSnap.get("role") || ""), already: true };
    }
    const inviteSnap = await tx.get(inviteRef);
    if (!inviteSnap.exists || inviteSnap.get("signIn") !== "google") {
      throw new HttpsError("permission-denied", "You are not on the HammondCare team.");
    }
    const role = inviteSnap.get("role");
    if (!isRole(role) || role === "super_admin") {
      throw new HttpsError("failed-precondition", "That invite is not valid.");
    }
    const displayName = String(inviteSnap.get("displayName") || record.displayName || email).slice(0, 80);
    const now = Timestamp.now();
    tx.set(userRef, {
      email,
      displayName,
      role,
      signIn: "google",
      active: true,
      protected: false,
      otpVerified: true,
      onShift: false,
      passwordChangedAt: now,
      passwordExpiresAt: Timestamp.fromDate(expiresAt(now.toDate(), 730)),
      createdAt: FieldValue.serverTimestamp(),
      createdBy: String(inviteSnap.get("createdBy") || ""),
    });
    tx.delete(inviteRef);
    return { role, already: false, displayName };
  });
  if (!joined.already && joined.displayName) {
    await auth.updateUser(uid, { displayName: joined.displayName });
  }
  if (isRole(joined.role)) {
    await auth.setCustomUserClaims(uid, { role: joined.role, active: true, otpVerified: true });
  }
  return { joined: true };
});

export const requestSignInCode = onCall(callable, async (request) => {
  const email = String(asObject(request.data).email ?? "").trim().toLowerCase();
  const account = await emailCodeAccount(email);
  return issueSignInCode(account.uid, email);
});

export const verifySignInCode = onCall(callable, async (request) => {
  const body = asObject(request.data);
  const email = String(body.email ?? "").trim().toLowerCase();
  const code = normalizeOtp(String(body.code ?? ""));
  if (!/^\d{6}$/.test(code)) throw new HttpsError("invalid-argument", "Enter the 6-digit code.");
  const account = await emailCodeAccount(email);
  const ref = db.doc(`private/otp/challenges/${account.uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("failed-precondition", "Request a code first.");
  const challenge = snap.data() as OtpChallenge;
  const result = checkOtpCode(challenge, account.uid, code, Date.now(), pepper());
  if (!result.ok) {
    await ref.update({ attempts: result.attempts });
    throw new HttpsError("invalid-argument", result.reason);
  }
  await db.doc(`users/${account.uid}`).update({ otpVerified: true });
  await auth.updateUser(account.uid, { emailVerified: true });
  await auth.setCustomUserClaims(account.uid, { role: account.role, active: true, otpVerified: true });
  await ref.delete();
  const token = await auth.createCustomToken(account.uid);
  return { token };
});

export const updateUserAccount = onCall(callable, async (request) => {
  const caller = await requireReadyUser(requireAuth(request));
  const body = asObject(request.data);
  const uid = String(body.uid ?? "");
  const displayName = String(body.displayName ?? "").trim();
  const roleValue = body.role;
  if (!uid) throw new HttpsError("invalid-argument", "Choose a person.");
  if (displayName.length < 1 || displayName.length > 80) {
    throw new HttpsError("invalid-argument", "Enter a name.");
  }
  const nextRole = roleValue === undefined ? null : roleValue;
  if (nextRole !== null && !isRole(nextRole)) throw new HttpsError("invalid-argument", "Choose a role.");
  const target = await readProfile(uid);
  try {
    assertCanEdit(caller, target, nextRole);
  } catch (error) {
    authz(error);
  }
  const role = (nextRole ?? target.role) as Role;
  await db.doc(`users/${uid}`).update({ displayName, role });
  await auth.updateUser(uid, { displayName });
  await auth.setCustomUserClaims(uid, { role, active: target.active, otpVerified: target.otpVerified });
  return { updated: true };
});

export const revokeUserAccount = onCall(callable, async (request) => {
  const caller = await requireReadyUser(requireAuth(request));
  const uid = String(asObject(request.data).uid ?? "");
  if (!uid) throw new HttpsError("invalid-argument", "Choose a person.");
  const target = await readProfile(uid);
  try {
    await revokeAccount(
      {
        markInactive: async (targetUid, by) => {
          await db.doc(`users/${targetUid}`).update({
            active: false,
            onShift: false,
            revokedAt: FieldValue.serverTimestamp(),
            revokedBy: by,
          });
        },
        setClaims: async (targetUid, role, active) => {
          await auth.setCustomUserClaims(targetUid, { role, active, otpVerified: false });
        },
        disableAuth: async (targetUid) => {
          await auth.updateUser(targetUid, { disabled: true });
        },
        revokeTokens: async (targetUid) => {
          await auth.revokeRefreshTokens(targetUid);
        },
        listTokens: async (targetUid) => {
          const devices = await db.collection(`users/${targetUid}/devices`).get();
          return devices.docs.map((doc) => String(doc.get("token") || "")).filter(Boolean);
        },
        unsubscribe: (tokens, targetUid) => unsubscribeTokens(messaging, tokens, targetUid),
        deleteTokens: async (targetUid) => {
          const devices = await db.collection(`users/${targetUid}/devices`).get();
          await Promise.all(devices.docs.map((doc) => doc.ref.delete()));
        },
      },
      caller,
      target,
    );
  } catch (error) {
    authz(error);
  }
  return { revoked: true };
});

export const updateAppSettings = onCall(callable, async (request) => {
  const caller = await requireReadyUser(requireAuth(request));
  if (caller.role !== "super_admin" || !caller.protected) {
    throw new HttpsError("permission-denied", "Only the super admin can change app settings.");
  }
  const body = asObject(request.data);
  const passwordMaxAgeDays = Number(body.passwordMaxAgeDays);
  const snoozeMinutes = Number(body.snoozeMinutes);
  const timezone = String(body.timezone ?? "");
  const colorScheme = String(body.colorScheme ?? "forest");
  if (!Number.isInteger(passwordMaxAgeDays) || passwordMaxAgeDays < 1 || passwordMaxAgeDays > 730) {
    throw new HttpsError("invalid-argument", "Password interval must be a whole number of days from 1 to 730.");
  }
  if (!Number.isInteger(snoozeMinutes) || snoozeMinutes < 1 || snoozeMinutes > 60) {
    throw new HttpsError("invalid-argument", "Snooze must be a whole number of minutes from 1 to 60.");
  }
  try {
    assertTimezone(timezone);
  } catch {
    throw new HttpsError("invalid-argument", "Choose a valid timezone.");
  }
  if (!isColorScheme(colorScheme)) {
    throw new HttpsError("invalid-argument", "Choose a color scheme.");
  }
  await db.doc("settings/app").update({ passwordMaxAgeDays, snoozeMinutes, timezone, colorScheme });
  const users = await db.collection("users").get();
  await Promise.all(
    users.docs.map((doc) => {
      if (normalizeSignIn(doc.get("signIn")) !== "password") return Promise.resolve();
      const changed = doc.get("passwordChangedAt")?.toDate?.() ?? new Date(0);
      return doc.ref.update({
        passwordExpiresAt: Timestamp.fromDate(expiresAt(changed, passwordMaxAgeDays)),
      });
    }),
  );
  return { updated: true };
});

export const registerDevice = onCall(callable, async (request) => {
  const caller = await requireReadyUser(requireAuth(request));
  const body = asObject(request.data);
  const token = String(body.token ?? "");
  const platform = String(body.platform ?? "web").slice(0, 40);
  if (token.length < 20 || token.length > 4096) throw new HttpsError("invalid-argument", "Missing push token.");
  const id = createHash("sha256").update(token).digest("hex");
  await db.doc(`users/${caller.uid}/devices/${id}`).set({
    token,
    platform,
    updatedAt: FieldValue.serverTimestamp(),
  });
  try {
    await messaging.subscribeToTopic(token, `user-${caller.uid}`);
    await messaging.subscribeToTopic(token, "homecare-broadcast");
  } catch (error) {
    logger.warn("Topic subscribe failed", error);
  }
  return { registered: true };
});

const MED_ACTIONS = ["given", "declined", "missed", "snooze"] as const;

export const logMedicationResponse = onCall(callable, async (request) => {
  const caller = await requireReadyUser(requireAuth(request));
  if (!caller.onShift) {
    throw new HttpsError("failed-precondition", "Switch to on shift before logging a medication.");
  }
  const body = asObject(request.data);
  const medicationId = String(body.medicationId ?? "");
  const scheduledTime = String(body.scheduledTime ?? "");
  const action = String(body.action ?? "");
  const note = String(body.note ?? "").trim().slice(0, 500);
  if (!MED_ACTIONS.includes(action as (typeof MED_ACTIONS)[number])) {
    throw new HttpsError("invalid-argument", "Choose given, declined, missed, or snooze.");
  }
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(scheduledTime)) {
    throw new HttpsError("invalid-argument", "That time is not valid.");
  }
  const medSnap = await db.doc(`medications/${medicationId}`).get();
  if (!medSnap.exists || medSnap.get("active") !== true) {
    throw new HttpsError("not-found", "That medication is not on the list.");
  }
  const times = (medSnap.get("times") as string[]) || [];
  if (!times.includes(scheduledTime)) throw new HttpsError("invalid-argument", "That time is not scheduled.");
  const settings = await readSettings();
  const day = zonedParts(new Date(), settings.timezone).date;
  await db.collection("medicationLogs").add({
    userId: caller.uid,
    userName: caller.displayName,
    medicationId,
    medicationName: String(medSnap.get("name") || ""),
    dose: String(medSnap.get("dose") || ""),
    scheduledTime,
    action,
    note,
    day,
    createdAt: FieldValue.serverTimestamp(),
  });
  if (action === "snooze") {
    const fireAt = new Date(Date.now() + settings.snoozeMinutes * 60 * 1000);
    await db.collection("medicationSnoozes").add({
      userId: caller.uid,
      medicationId,
      medicationName: String(medSnap.get("name") || ""),
      dose: String(medSnap.get("dose") || ""),
      scheduledTime,
      fireAt: Timestamp.fromDate(fireAt),
      status: "pending",
    });
  }
  return { logged: true };
});

async function loadActiveUsers(): Promise<ReminderUser[]> {
  const snap = await db.collection("users").get();
  return snap.docs.map((doc) => ({
    uid: doc.id,
    displayName: String(doc.get("displayName") || ""),
    active: doc.get("active") === true,
    otpVerified: doc.get("otpVerified") === true,
    onShift: doc.get("onShift") === true,
  }));
}

async function dispatchDueReminders(now = new Date()): Promise<number> {
  const settings = await readSettings();
  const zoned = zonedParts(now, settings.timezone);
  const medSnap = await db.collection("medications").where("active", "==", true).get();
  const medications: ReminderMed[] = medSnap.docs.map((doc) => ({
    id: doc.id,
    name: String(doc.get("name") || ""),
    dose: String(doc.get("dose") || ""),
    times: (doc.get("times") as string[]) || [],
    active: true,
  }));
  const users = await loadActiveUsers();
  const snoozeSnap = await db.collection("medicationSnoozes").where("status", "==", "pending").get();
  const snoozes: PendingSnooze[] = snoozeSnap.docs.map((doc) => ({
    id: doc.id,
    userId: String(doc.get("userId") || ""),
    medicationId: String(doc.get("medicationId") || ""),
    medicationName: String(doc.get("medicationName") || ""),
    dose: String(doc.get("dose") || ""),
    scheduledTime: String(doc.get("scheduledTime") || ""),
    fireAt: doc.get("fireAt")?.toDate?.() ?? new Date(0),
  }));
  const receiptSnap = await db.collection("reminderReceipts").get();
  const alreadySent = new Set(receiptSnap.docs.map((doc) => doc.id));
  const dispatches = selectMedicationDispatches({
    now,
    date: zoned.date,
    time: zoned.time,
    medications,
    users,
    alreadySent,
    snoozes,
  });

  for (const item of dispatches) {
    const receipt = db.doc(`reminderReceipts/${item.receiptId}`);
    const claimed = await db.runTransaction(async (tx) => {
      const current = await tx.get(receipt);
      if (current.exists) return false;
      tx.set(receipt, { at: FieldValue.serverTimestamp(), uid: item.uid, medicationId: item.medicationId });
      return true;
    });
    if (!claimed) continue;
    await sendVisiblePush(db, messaging, [item.uid], {
      title: item.title,
      body: item.body,
      link: `/?view=home&med=${encodeURIComponent(item.medicationId)}&time=${encodeURIComponent(item.scheduledTime)}`,
      data: {
        type: "medication",
        medicationId: item.medicationId,
        scheduledTime: item.scheduledTime,
        title: item.title,
        body: item.body,
      },
    });
    if (item.snoozeId) {
      await db.doc(`medicationSnoozes/${item.snoozeId}`).update({ status: "sent" });
    }
  }

  const expiredCutoff = now.getTime() - 10 * 60 * 1000;
  await Promise.all(
    snoozes
      .filter((snooze) => snooze.fireAt.getTime() < expiredCutoff)
      .map((snooze) => db.doc(`medicationSnoozes/${snooze.id}`).update({ status: "expired" })),
  );
  return dispatches.length;
}

export const dispatchMedicationReminders = onSchedule(
  { schedule: "every 1 minutes", timeZone: "Etc/UTC" },
  async () => {
    const count = await dispatchDueReminders(new Date());
    logger.info(`Medication reminder pass sent ${count}`);
  },
);

export const requestShiftCoverage = onCall(callable, async (request) => {
  const caller = await requireReadyUser(requireAuth(request));
  const body = asObject(request.data);
  const shiftId = String(body.shiftId ?? "");
  const type = body.type === "day_off" ? "day_off" : body.type === "swap" ? "swap" : "";
  if (!shiftId || !type) throw new HttpsError("invalid-argument", "Choose a shift and a request type.");
  const shiftSnap = await db.doc(`shifts/${shiftId}`).get();
  if (!shiftSnap.exists) throw new HttpsError("not-found", "That shift was not found.");
  if (shiftSnap.get("userId") !== caller.uid) {
    throw new HttpsError("permission-denied", "You can only request coverage for your own shift.");
  }
  const open = await db.collection("shiftRequests").where("shiftId", "==", shiftId).where("status", "==", "pending").limit(1).get();
  if (!open.empty) throw new HttpsError("failed-precondition", "There is already an open request for that shift.");
  const at = new Date().toISOString();
  const ref = await db.collection("shiftRequests").add({
    type,
    shiftId,
    shiftDate: shiftSnap.get("date"),
    shiftStart: shiftSnap.get("start"),
    shiftEnd: shiftSnap.get("end"),
    requesterId: caller.uid,
    requesterName: caller.displayName,
    status: "pending",
    acceptedBy: null,
    acceptedByName: null,
    requestedAt: FieldValue.serverTimestamp(),
    resolvedAt: null,
    history: [{ action: "requested", uid: caller.uid, name: caller.displayName, at }],
  });
  const users = await loadActiveUsers();
  const label = type === "day_off" ? "a day off" : "a shift swap";
  await sendVisiblePush(
    db,
    messaging,
    users.filter((user) => user.uid !== caller.uid).map((user) => user.uid),
    {
      title: "Coverage request",
      body: `${caller.displayName} requested ${label} on ${shiftSnap.get("date")} ${shiftSnap.get("start")}–${shiftSnap.get("end")}.`,
      link: "/?view=calendar",
      data: { type: "swap", requestId: ref.id, title: "Coverage request", body: caller.displayName },
    },
  );
  return { id: ref.id };
});

async function loadRequest(id: string): Promise<ShiftRequestRecord & { refPath: string; shiftId: string }> {
  const snap = await db.doc(`shiftRequests/${id}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "That request was not found.");
  return {
    refPath: snap.ref.path,
    type: snap.get("type"),
    shiftId: String(snap.get("shiftId")),
    requesterId: String(snap.get("requesterId")),
    status: snap.get("status"),
    history: (snap.get("history") as ShiftRequestRecord["history"]) || [],
  };
}

export const acceptShiftRequest = onCall(callable, async (request) => {
  const caller = await requireReadyUser(requireAuth(request));
  const id = String(asObject(request.data).id ?? "");
  if (!id) throw new HttpsError("invalid-argument", "Choose a request.");
  const current = await loadRequest(id);
  const shiftSnap = await db.doc(`shifts/${current.shiftId}`).get();
  if (!shiftSnap.exists) throw new HttpsError("not-found", "That shift was not found.");
  const shift: ShiftRecord = {
    userId: String(shiftSnap.get("userId")),
    userName: String(shiftSnap.get("userName")),
    date: String(shiftSnap.get("date")),
    start: String(shiftSnap.get("start")),
    end: String(shiftSnap.get("end")),
  };
  let next: ReturnType<typeof applyAcceptance>;
  try {
    next = applyAcceptance(shift, current, { uid: caller.uid, name: caller.displayName }, new Date().toISOString());
  } catch (error) {
    throw new HttpsError("failed-precondition", error instanceof Error ? error.message : "Could not accept.");
  }
  await db.runTransaction(async (tx) => {
    const requestRef = db.doc(`shiftRequests/${id}`);
    const shiftRef = db.doc(`shifts/${current.shiftId}`);
    const freshRequest = await tx.get(requestRef);
    const freshShift = await tx.get(shiftRef);
    if (freshRequest.get("status") !== "pending") {
      throw new HttpsError("failed-precondition", "That request is no longer open.");
    }
    if (freshShift.get("userId") !== current.requesterId) {
      throw new HttpsError("failed-precondition", "That shift has already changed.");
    }
    tx.update(shiftRef, {
      userId: next.shift.userId,
      userName: next.shift.userName,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(requestRef, {
      status: "accepted",
      acceptedBy: caller.uid,
      acceptedByName: caller.displayName,
      resolvedAt: FieldValue.serverTimestamp(),
      history: next.request.history,
    });
  });
  await sendVisiblePush(db, messaging, [current.requesterId], {
    title: "Coverage accepted",
    body: `${caller.displayName} took the shift on ${shift.date} ${shift.start}–${shift.end}.`,
    link: "/?view=calendar",
    data: { type: "swap", requestId: id, title: "Coverage accepted", body: caller.displayName },
  });
  return { accepted: true };
});

export const cancelShiftRequest = onCall(callable, async (request) => {
  const caller = await requireReadyUser(requireAuth(request));
  const id = String(asObject(request.data).id ?? "");
  const current = await loadRequest(id);
  if (current.status !== "pending") throw new HttpsError("failed-precondition", "That request is no longer open.");
  if (current.requesterId !== caller.uid) throw new HttpsError("permission-denied", "Only the requester can cancel.");
  await db.doc(`shiftRequests/${id}`).update({
    status: "cancelled",
    resolvedAt: FieldValue.serverTimestamp(),
    history: [
      ...current.history,
      { action: "cancelled", uid: caller.uid, name: caller.displayName, at: new Date().toISOString() },
    ],
  });
  return { cancelled: true };
});

async function notifyMessage(
  senderId: string,
  senderName: string,
  text: string,
  threadId: string,
  directParticipantIds?: string[],
): Promise<void> {
  const users = await loadActiveUsers();
  const preview = text.length > 120 ? `${text.slice(0, 117)}...` : text;
  let recipients: string[];
  if (directParticipantIds) {
    recipients = directParticipantIds.filter((uid) => uid !== senderId);
  } else {
    recipients = users.filter((user) => user.uid !== senderId).map((user) => user.uid);
  }
  await sendVisiblePush(db, messaging, recipients, {
    title: senderName || "New message",
    body: preview,
    link: `/?view=messages&thread=${encodeURIComponent(threadId)}`,
    data: { type: "message", threadId, title: senderName || "New message", body: preview },
  });
}

export const onGroupMessage = onDocumentCreated("groupThread/{docId}/messages/{messageId}", async (event) => {
  if (event.params.docId !== "main" || !event.data) return;
  const data = event.data.data();
  await notifyMessage(String(data.senderId || ""), String(data.senderName || ""), String(data.text || ""), "group");
});

export const onDirectMessage = onDocumentCreated("threads/{threadId}/messages/{messageId}", async (event) => {
  if (!event.data) return;
  const data = event.data.data();
  const thread = await db.doc(`threads/${event.params.threadId}`).get();
  const participantIds = (thread.get("participantIds") as string[]) || [];
  await notifyMessage(
    String(data.senderId || ""),
    String(data.senderName || ""),
    String(data.text || ""),
    event.params.threadId,
    participantIds,
  );
});
