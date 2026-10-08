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
import { gmailEnabledWithoutEmail, sendOtpEmail, sendWelcomeEmail } from "./email";
import { sendVisiblePush, unsubscribeTokens } from "./notify";
import { assertCanAssign, assertCanEdit, AuthzError, deleteAccount, planEmailUpdate, revokeAccount } from "./logic/accounts";
import { normalizePhone } from "./logic/phone";
import { OTP_TTL_MS, canSendOtp, checkOtpCode, hashOtp, normalizeOtp, type OtpChallenge } from "./logic/otp";
import { assertTimezone, expiresAt, validatePassword } from "./logic/password";
import { normalizeEmoji, withEmoji } from "./logic/emoji";
import { isNewSignInMethod, needsPasswordChange, normalizeSignIn } from "./logic/signin";
import { DEFAULT_COLOR_SCHEME, isColorScheme, normalizePersonalColorScheme } from "./logic/themes";
import { canClearUserEmoji, canDeleteMessage, canManageSchedule, isAccountEnabled, isRole, type Role } from "./logic/roles";
import {
  careTeamRecipients,
  coverageRecipients,
  directRecipients,
  messageRecipients,
  selectMedicationDispatches,
  type PendingSnooze,
  type ReminderMed,
  type ReminderUser,
} from "./logic/reminders";
import {
  coverageKind,
  exceptionFromData,
  isAwayKind,
  isDuringShift,
  planCoverageWrite,
  planDirectSwap,
  planShiftSync,
  promoteSwap,
  resolveDay,
  shiftKey,
  templateApplies,
  templateFromData,
} from "./logic/schedule";
import { applyAcceptance, assertCoverageApproval, type ShiftRecord, type ShiftRequestRecord } from "./logic/shifts";
import { handoverNoteDay, shouldArchiveHandover } from "./logic/handover";
import { zonedParts } from "./logic/time";
import { coverageMessageText, messagePreview, replaceParticipant, type CoverageNotice } from "./logic/messages";

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
    emoji: profile.emoji,
    onShift: profile.onShift,
    signIn: profile.signIn,
    passwordChangeRequired: needsPasswordChange(profile.signIn, active, profile.otpVerified, expires, new Date()),
    passwordMaxAgeDays: settings.passwordMaxAgeDays,
    timezone: settings.timezone,
    snoozeMinutes: settings.snoozeMinutes,
    colorScheme: settings.colorScheme,
    personalColorScheme: profile.colorScheme,
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
  if (!isAccountEnabled({ enabled: snap.get("enabled") as boolean | undefined })) {
    throw new HttpsError("permission-denied", "This account is not enabled yet.");
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
  const phone = normalizePhone(body.phone);
  if (!phone.ok) throw new HttpsError("invalid-argument", phone.reason);
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
  const enableNow = body.enableNow === true;
  let created: { uid: string };
  try {
    created = await auth.createUser({ email, displayName, disabled: true });
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
    phone: phone.phone,
    role,
    signIn,
    emoji: "",
    colorScheme: "",
    active: true,
    enabled: false,
    awaitingGoogle: false,
    protected: false,
    otpVerified: false,
    onShift: false,
    passwordChangedAt: Timestamp.fromDate(now),
    passwordExpiresAt: Timestamp.fromDate(expiresAt(now, settings.passwordMaxAgeDays)),
    createdAt: FieldValue.serverTimestamp(),
    createdBy: caller.uid,
  });
  await auth.setCustomUserClaims(created.uid, { role, active: true, otpVerified: false });
  if (!enableNow) return { uid: created.uid, enabled: false };
  try {
    const enabled = await enableRosterAccount(created.uid, caller.uid);
    return { uid: created.uid, enabled: true, emailError: enabled.emailNote || undefined };
  } catch (error) {
    const message = error instanceof HttpsError ? error.message : "The welcome email could not be sent.";
    return { uid: created.uid, enabled: false, emailError: message };
  }
});

async function enableRosterAccount(uid: string, by: string): Promise<{ emailNote: string }> {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "That person was not found.");
  if (snap.get("active") !== true) throw new HttpsError("failed-precondition", "This account has been revoked.");
  if (snap.get("protected") === true || snap.get("role") === "super_admin") {
    throw new HttpsError("failed-precondition", "That account is already on the team.");
  }
  if (isAccountEnabled({ enabled: snap.get("enabled") as boolean | undefined })) {
    throw new HttpsError("failed-precondition", "This person is already enabled.");
  }
  const email = String(snap.get("email") || "").trim().toLowerCase();
  const displayName = String(snap.get("displayName") || email);
  const role = snap.get("role");
  const signIn = snap.get("signIn") === "google" ? "google" : "email_otp";
  if (!isRole(role) || role === "super_admin") throw new HttpsError("failed-precondition", "That account has no role.");
  const welcome = await sendWelcomeEmail(email, displayName, signIn);
  const emailNote = welcome === "skipped" ? gmailEnabledWithoutEmail() : "";
  if (signIn === "google") {
    try {
      await auth.deleteUser(uid);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "auth/user-not-found") throw error;
    }
    await db.doc(`users/${uid}`).update({ enabled: true, awaitingGoogle: true });
    await db.doc(`invites/${email}`).set({
      email,
      displayName,
      role,
      signIn: "google",
      rosterUid: uid,
      createdBy: by,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { emailNote };
  }
  try {
    await auth.updateUser(uid, { disabled: false, displayName });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "auth/user-not-found") {
      throw new HttpsError("failed-precondition", "That sign-in could not be turned on.");
    }
    throw error;
  }
  await db.doc(`users/${uid}`).update({ enabled: true, awaitingGoogle: false });
  return { emailNote };
}

export const enableUserAccount = onCall(callable, async (request) => {
  const caller = await requireReadyUser(requireAuth(request));
  if (caller.role !== "super_admin" || !caller.protected) {
    throw new HttpsError("permission-denied", "Only the super admin can enable a person.");
  }
  const uid = String(asObject(request.data).uid ?? "");
  if (!uid) throw new HttpsError("invalid-argument", "Choose a person.");
  const enabled = await enableRosterAccount(uid, caller.uid);
  return { enabled: true, emailNote: enabled.emailNote };
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
  const rosterUid = String(snap.get("rosterUid") || "");
  const displayName = String(snap.get("displayName") || email);
  if (rosterUid) {
    const profile = await db.doc(`users/${rosterUid}`).get();
    if (profile.exists) {
      await db.doc(`users/${rosterUid}`).update({ enabled: false, awaitingGoogle: false });
    }
  }
  await ref.delete();
  if (rosterUid) {
    try {
      await auth.getUser(rosterUid);
      await auth.updateUser(rosterUid, { disabled: true, email, displayName });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "auth/user-not-found") throw error;
      await auth.createUser({ uid: rosterUid, email, displayName, disabled: true });
    }
  }
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
      if (!isAccountEnabled({ enabled: userSnap.get("enabled") as boolean | undefined })) {
        throw new HttpsError("permission-denied", "This account is not enabled yet.");
      }
      return { role: String(userSnap.get("role") || ""), already: true, rosterUid: String(userSnap.get("migratedFrom") || "") };
    }
    const inviteSnap = await tx.get(inviteRef);
    if (!inviteSnap.exists || inviteSnap.get("signIn") !== "google") {
      throw new HttpsError("permission-denied", "You are not on the HammondCare team.");
    }
    const role = inviteSnap.get("role");
    if (!isRole(role) || role === "super_admin") {
      throw new HttpsError("failed-precondition", "That invite is not valid.");
    }
    const rosterUid = String(inviteSnap.get("rosterUid") || "");
    const displayName = String(inviteSnap.get("displayName") || record.displayName || email).slice(0, 80);
    const now = Timestamp.now();
    if (rosterUid && rosterUid !== uid) {
      const rosterRef = db.doc(`users/${rosterUid}`);
      const rosterSnap = await tx.get(rosterRef);
      if (!rosterSnap.exists || rosterSnap.get("active") !== true) {
        throw new HttpsError("permission-denied", "You are not on the HammondCare team.");
      }
      if (!isAccountEnabled({ enabled: rosterSnap.get("enabled") as boolean | undefined })) {
        throw new HttpsError("permission-denied", "This account is not enabled yet.");
      }
      tx.set(userRef, {
        email,
        displayName: String(rosterSnap.get("displayName") || displayName).slice(0, 80),
        role: isRole(rosterSnap.get("role")) ? rosterSnap.get("role") : role,
        signIn: "google",
        emoji: String(rosterSnap.get("emoji") || ""),
        colorScheme: String(rosterSnap.get("colorScheme") || ""),
        active: true,
        enabled: true,
        awaitingGoogle: false,
        protected: false,
        otpVerified: true,
        onShift: rosterSnap.get("onShift") === true,
        shiftHold: rosterSnap.get("shiftHold") === true,
        passwordChangedAt: rosterSnap.get("passwordChangedAt") || now,
        passwordExpiresAt: rosterSnap.get("passwordExpiresAt") || Timestamp.fromDate(expiresAt(now.toDate(), 730)),
        createdAt: rosterSnap.get("createdAt") || FieldValue.serverTimestamp(),
        createdBy: String(rosterSnap.get("createdBy") || inviteSnap.get("createdBy") || ""),
        migratedFrom: rosterUid,
      });
      tx.delete(rosterRef);
      tx.delete(inviteRef);
      return { role, already: false, displayName: String(rosterSnap.get("displayName") || displayName), rosterUid };
    }
    tx.set(userRef, {
      email,
      displayName,
      role,
      signIn: "google",
      emoji: "",
      colorScheme: "",
      active: true,
      enabled: true,
      awaitingGoogle: false,
      protected: false,
      otpVerified: true,
      onShift: false,
      passwordChangedAt: now,
      passwordExpiresAt: Timestamp.fromDate(expiresAt(now.toDate(), 730)),
      createdAt: FieldValue.serverTimestamp(),
      createdBy: String(inviteSnap.get("createdBy") || ""),
    });
    tx.delete(inviteRef);
    return { role, already: false, displayName, rosterUid: "" };
  });
  if (!joined.already && joined.displayName) {
    await auth.updateUser(uid, { displayName: joined.displayName });
  }
  if (joined.rosterUid) {
    await migrateRosterRefs(joined.rosterUid, uid);
    await db.doc(`users/${uid}`).update({ migratedFrom: FieldValue.delete() });
  }
  if (isRole(joined.role)) {
    await auth.setCustomUserClaims(uid, { role: joined.role, active: true, otpVerified: true });
  }
  return { joined: true };
});

async function migrateRosterRefs(fromUid: string, toUid: string): Promise<void> {
  const [templates, exceptions, requested, accepted, threads] = await Promise.all([
    db.collection("shiftTemplates").where("userId", "==", fromUid).get(),
    db.collection("shiftExceptions").where("userId", "==", fromUid).get(),
    db.collection("shiftRequests").where("requesterId", "==", fromUid).get(),
    db.collection("shiftRequests").where("acceptedBy", "==", fromUid).get(),
    db.collection("threads").where("participantIds", "array-contains", fromUid).get(),
  ]);
  const writes = new Map<string, Record<string, string>>();
  const put = (path: string, data: Record<string, string>) => {
    writes.set(path, { ...(writes.get(path) ?? {}), ...data });
  };
  for (const item of templates.docs) put(item.ref.path, { userId: toUid });
  for (const item of exceptions.docs) put(item.ref.path, { userId: toUid });
  for (const item of requested.docs) put(item.ref.path, { requesterId: toUid });
  for (const item of accepted.docs) put(item.ref.path, { acceptedBy: toUid });
  const entries = [...writes.entries()];
  for (let index = 0; index < entries.length; index += 400) {
    const batch = db.batch();
    for (const [path, data] of entries.slice(index, index + 400)) batch.update(db.doc(path), data);
    await batch.commit();
  }
  for (let index = 0; index < threads.docs.length; index += 400) {
    const batch = db.batch();
    for (const item of threads.docs.slice(index, index + 400)) {
      batch.update(item.ref, {
        participantIds: replaceParticipant((item.get("participantIds") as string[]) || [], fromUid, toUid),
      });
    }
    await batch.commit();
  }
}

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

async function relocateInvites(uid: string, previousEmail: string, nextEmail: string): Promise<void> {
  const found = await db.collection("invites").where("rosterUid", "==", uid).get();
  const invites = found.docs.map((item) => item);
  if (invites.length === 0 && previousEmail) {
    const direct = await db.doc(`invites/${previousEmail}`).get();
    const rosterUid = String(direct.get("rosterUid") || "");
    if (direct.exists && (!rosterUid || rosterUid === uid)) {
      await db.doc(`invites/${nextEmail}`).set({ ...(direct.data() ?? {}), email: nextEmail });
      if (direct.id !== nextEmail) await direct.ref.delete();
      return;
    }
  }
  for (const item of invites) {
    if (item.id === nextEmail) {
      await item.ref.update({ email: nextEmail });
      continue;
    }
    await db.doc(`invites/${nextEmail}`).set({ ...(item.data() ?? {}), email: nextEmail });
    await item.ref.delete();
  }
}

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
  const settings = await readSettings();
  let emailPlan: ReturnType<typeof planEmailUpdate>;
  try {
    assertCanEdit(caller, target, nextRole);
    emailPlan = planEmailUpdate({
      currentEmail: target.email,
      nextEmail: body.email === undefined || body.email === null ? target.email : String(body.email),
      signIn: target.signIn,
      protectedAccount: target.protected || target.role === "super_admin",
      superAdminEmail: settings.superAdminEmail,
    });
  } catch (error) {
    authz(error);
  }
  const role = (nextRole ?? target.role) as Role;
  if (emailPlan.changed) await assertEmailFree(emailPlan.email);
  let phone: string | undefined;
  if (body.phone !== undefined && body.phone !== null) {
    const parsed = normalizePhone(body.phone);
    if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.reason);
    phone = parsed.phone;
  }
  const profileUpdate: { displayName: string; role: Role; email?: string; otpVerified?: boolean; phone?: string } = {
    displayName,
    role,
  };
  if (phone !== undefined) profileUpdate.phone = phone;
  if (emailPlan.changed) {
    profileUpdate.email = emailPlan.email;
    if (emailPlan.clearVerification) profileUpdate.otpVerified = false;
  }
  const authUpdate: { displayName: string; email?: string; emailVerified?: boolean } = { displayName };
  if (emailPlan.changed) {
    authUpdate.email = emailPlan.email;
    if (emailPlan.clearVerification) authUpdate.emailVerified = false;
  }
  let authChanged = false;
  try {
    await auth.updateUser(uid, authUpdate);
    authChanged = emailPlan.changed;
    if (emailPlan.changed) await auth.revokeRefreshTokens(uid);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "That email already has an account.");
    }
    if (code !== "auth/user-not-found") throw error;
  }
  try {
    await db.doc(`users/${uid}`).update(profileUpdate);
    if (emailPlan.changed) await relocateInvites(uid, target.email.trim().toLowerCase(), emailPlan.email);
  } catch (error) {
    if (authChanged) {
      await auth.updateUser(uid, { email: target.email, displayName: target.displayName });
    }
    throw error;
  }
  await auth.setCustomUserClaims(uid, {
    role,
    active: target.active,
    otpVerified: emailPlan.changed && emailPlan.clearVerification ? false : target.otpVerified,
  }).catch((error: { code?: string }) => {
    if (error.code === "auth/user-not-found") return;
    throw error;
  });
  return { updated: true, email: emailPlan.email };
});

export const setMyEmoji = onCall(callable, async (request) => {
  const caller = await requireReadyUser(requireAuth(request));
  const parsed = normalizeEmoji(String(asObject(request.data).emoji ?? ""));
  if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.reason);
  await db.doc(`users/${caller.uid}`).update({ emoji: parsed.emoji });
  return { emoji: parsed.emoji };
});

export const clearUserEmoji = onCall(callable, async (request) => {
  const caller = await requireReadyUser(requireAuth(request));
  const uid = String(asObject(request.data).uid ?? "");
  if (!canClearUserEmoji(caller.role, caller.uid, uid)) {
    throw new HttpsError("permission-denied", "Only an admin can clear someone else's emoji.");
  }
  await readProfile(uid);
  await db.doc(`users/${uid}`).update({ emoji: "" });
  return { cleared: true };
});

export const setMyColorScheme = onCall(callable, async (request) => {
  const caller = await requireReadyUser(requireAuth(request));
  const parsed = normalizePersonalColorScheme(asObject(request.data).colorScheme);
  if (!parsed.ok) throw new HttpsError("invalid-argument", parsed.reason);
  await db.doc(`users/${caller.uid}`).update({ colorScheme: parsed.colorScheme });
  return { colorScheme: parsed.colorScheme };
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

async function deleteMatching(collectionName: string, field: string, value: string): Promise<void> {
  const snap = await db.collection(collectionName).where(field, "==", value).get();
  await Promise.all(snap.docs.map((item) => item.ref.delete()));
}

export const deleteUserAccount = onCall(callable, async (request) => {
  const caller = await requireReadyUser(requireAuth(request));
  const uid = String(asObject(request.data).uid ?? "");
  if (!uid) throw new HttpsError("invalid-argument", "Choose a person.");
  const target = await readProfile(uid);
  try {
    await deleteAccount(
      {
        removeProfile: async (targetUid) => {
          await db.doc(`users/${targetUid}`).delete();
        },
        removeAuth: async (targetUid) => {
          try {
            await auth.deleteUser(targetUid);
          } catch (error) {
            const code = (error as { code?: string }).code;
            if (code !== "auth/user-not-found") throw error;
          }
        },
        removeInvite: async (email, targetUid) => {
          const address = email.trim().toLowerCase();
          if (address) await db.doc(`invites/${address}`).delete();
          await deleteMatching("invites", "rosterUid", targetUid);
        },
        removeSchedule: async (targetUid) => {
          await deleteMatching("shiftTemplates", "userId", targetUid);
          await deleteMatching("shiftExceptions", "userId", targetUid);
          await deleteMatching("shiftRequests", "requesterId", targetUid);
        },
        removeDevices: async (targetUid) => {
          const devices = await db.collection(`users/${targetUid}/devices`).get();
          const tokens = devices.docs.map((item) => String(item.get("token") || "")).filter(Boolean);
          await unsubscribeTokens(messaging, tokens, targetUid);
          await Promise.all(devices.docs.map((item) => item.ref.delete()));
        },
      },
      caller,
      target,
    );
  } catch (error) {
    authz(error);
  }
  return { deleted: true };
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
  const colorScheme = String(body.colorScheme ?? DEFAULT_COLOR_SCHEME);
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
    throw new HttpsError("failed-precondition", "Turn on shift before logging a medication.");
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

async function syncScheduledShifts(date: string, time: string): Promise<void> {
  const [userSnap, templateSnap, exceptionSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("shiftTemplates").get(),
    db.collection("shiftExceptions").where("date", "==", date).get(),
  ]);
  const templates = templateSnap.docs.map((item) => templateFromData(item.id, item.data() as Record<string, unknown>));
  const exceptions = exceptionSnap.docs.map((item) => exceptionFromData(item.id, item.data() as Record<string, unknown>));
  const resolved = resolveDay(date, templates, exceptions);
  let batch = db.batch();
  let pending = 0;
  const commit = async () => {
    if (!pending) return;
    await batch.commit();
    batch = db.batch();
    pending = 0;
  };
  for (const userDoc of userSnap.docs) {
    const onShift = userDoc.get("onShift") === true;
    const shiftHold = userDoc.get("shiftHold") === true;
    const scheduled = isDuringShift(time, resolved, userDoc.id);
    const plan = planShiftSync({ onShift, shiftHold, scheduled });
    if (!plan.write) continue;
    const patch: { onShift?: boolean; shiftHold?: boolean } = {};
    if (plan.onShift !== onShift) patch.onShift = plan.onShift;
    if (plan.shiftHold !== shiftHold) patch.shiftHold = plan.shiftHold;
    if (Object.keys(patch).length === 0) continue;
    batch.update(userDoc.ref, patch);
    pending += 1;
    if (pending >= 400) await commit();
  }
  await commit();
}

async function loadActiveUsers(): Promise<Array<ReminderUser & { emoji: string }>> {
  const snap = await db.collection("users").get();
  return snap.docs.map((doc) => ({
    uid: doc.id,
    displayName: String(doc.get("displayName") || ""),
    emoji: String(doc.get("emoji") || ""),
    role: String(doc.get("role") || ""),
    enabled: doc.get("enabled") !== false,
    active: doc.get("active") === true,
    otpVerified: doc.get("otpVerified") === true,
    onShift: doc.get("onShift") === true,
  }));
}

async function dispatchDueReminders(now = new Date()): Promise<number> {
  const settings = await readSettings();
  const zoned = zonedParts(now, settings.timezone);
  await syncScheduledShifts(zoned.date, zoned.time);
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

export async function archivePreviousHandoverNotes(now = new Date()): Promise<number> {
  const settings = await readSettings();
  const today = zonedParts(now, settings.timezone).date;
  const snap = await db.collection("handoverNotes").get();
  const due = snap.docs.filter((item) => {
    const created = item.get("createdAt");
    return shouldArchiveHandover(
      {
        day: typeof item.get("day") === "string" ? item.get("day") : "",
        createdAt: created && typeof created.toDate === "function" ? created.toDate() : null,
      },
      today,
      settings.timezone,
    );
  });
  for (const item of due) {
    const created = item.get("createdAt");
    const imagePath = item.get("imagePath");
    const day = handoverNoteDay(
      {
        day: typeof item.get("day") === "string" ? item.get("day") : "",
        createdAt: created && typeof created.toDate === "function" ? created.toDate() : null,
      },
      settings.timezone,
    );
    await db.doc(`handoverLog/${item.id}`).set({
      body: String(item.get("body") || ""),
      authorId: String(item.get("authorId") || ""),
      authorName: String(item.get("authorName") || ""),
      imagePath: typeof imagePath === "string" ? imagePath : "",
      createdAt: created || FieldValue.serverTimestamp(),
      day,
      archivedAt: FieldValue.serverTimestamp(),
    });
    await item.ref.delete();
  }
  return due.length;
}

export const archiveHandoverNotes = onSchedule({ schedule: "every 60 minutes", timeZone: "Etc/UTC" }, async () => {
  const count = await archivePreviousHandoverNotes(new Date());
  logger.info(`Archived ${count} handover notes from earlier days`);
});

export const dispatchMedicationReminders = onSchedule(
  { schedule: "every 1 minutes", timeZone: "Etc/UTC" },
  async () => {
    const count = await dispatchDueReminders(new Date());
    logger.info(`Medication reminder pass sent ${count}`);
  },
);

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export const assignShiftSwap = onCall(callable, async (request) => {
  const caller = await requireReadyUser(requireAuth(request));
  if (!canManageSchedule(caller.role)) {
    throw new HttpsError("permission-denied", "Only a team lead or admin can swap a shift.");
  }
  const body = asObject(request.data);
  const templateId = String(body.templateId ?? "");
  const date = String(body.date ?? "");
  const assigneeId = String(body.assigneeId ?? "");
  if (!templateId || !isIsoDate(date) || !assigneeId) {
    throw new HttpsError("invalid-argument", "Choose a shift and an employee.");
  }
  const assignee = await readProfile(assigneeId);
  if (!assignee.active) throw new HttpsError("failed-precondition", "Choose an employee who is still on the roster.");
  const templateRef = db.doc(`shiftTemplates/${templateId}`);
  const templateSnap = await templateRef.get();
  if (!templateSnap.exists) throw new HttpsError("not-found", "That weekly shift was not found.");
  const shiftId = shiftKey(templateId, date);
  await db.runTransaction(async (tx) => {
    const freshTemplate = await tx.get(templateRef);
    const freshAssignee = await tx.get(db.doc(`users/${assigneeId}`));
    const freshExceptions = await tx.get(
      db.collection("shiftExceptions").where("templateId", "==", templateId).where("date", "==", date),
    );
    const openRequests = await tx.get(
      db.collection("shiftRequests").where("shiftId", "==", shiftId).where("status", "==", "pending"),
    );
    if (!freshTemplate.exists) throw new HttpsError("not-found", "That weekly shift was not found.");
    if (!freshAssignee.exists || freshAssignee.get("active") !== true) {
      throw new HttpsError("failed-precondition", "Choose an employee who is still on the roster.");
    }
    const assigneeName = String(freshAssignee.get("displayName") ?? "").trim();
    const template = templateFromData(templateId, freshTemplate.data() as Record<string, unknown>);
    const exceptions = freshExceptions.docs.map((item) => exceptionFromData(item.id, item.data() as Record<string, unknown>));
    let plan: ReturnType<typeof planDirectSwap>;
    try {
      plan = planDirectSwap({ template, date, exceptions, assigneeId, assigneeName });
    } catch (error) {
      throw new HttpsError("failed-precondition", error instanceof Error ? error.message : "Could not swap that shift.");
    }
    const existing = freshExceptions.docs.slice().sort((a, b) => a.id.localeCompare(b.id))[0];
    if (plan.write === "update" && existing) {
      tx.update(existing.ref, {
        userId: assigneeId,
        userName: assigneeName,
        kind: "swap",
        start: plan.start,
        end: plan.end,
        requestId: "",
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      tx.set(db.collection("shiftExceptions").doc(), {
        date,
        templateId,
        kind: "swap",
        userId: assigneeId,
        userName: assigneeName,
        start: plan.start,
        end: plan.end,
        requestId: "",
        createdBy: caller.uid,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    const at = new Date().toISOString();
    for (const item of openRequests.docs) {
      const history = (item.get("history") as { action: string; uid: string; name: string; at: string }[]) || [];
      tx.update(item.ref, {
        status: "cancelled",
        resolvedAt: FieldValue.serverTimestamp(),
        history: [...history, { action: "cancelled", uid: caller.uid, name: caller.displayName, at }],
      });
    }
  });
  return { swapped: true };
});

export const requestShiftCoverage = onCall(callable, async (request) => {
  const caller = await requireReadyUser(requireAuth(request));
  const body = asObject(request.data);
  const templateId = String(body.templateId ?? "");
  const date = String(body.date ?? "");
  const type = coverageKind(body.type);
  if (!templateId || !isIsoDate(date) || !type) {
    throw new HttpsError("invalid-argument", "Choose a shift and a request type.");
  }
  const templateSnap = await db.doc(`shiftTemplates/${templateId}`).get();
  if (!templateSnap.exists) throw new HttpsError("not-found", "That weekly shift was not found.");
  const template = templateFromData(templateId, templateSnap.data() as Record<string, unknown>);
  if (!templateApplies(template, date)) {
    throw new HttpsError("failed-precondition", "That weekly shift does not cover this date.");
  }
  const exceptionSnap = await db.collection("shiftExceptions").where("templateId", "==", templateId).where("date", "==", date).get();
  const exceptions = exceptionSnap.docs.map((item) => exceptionFromData(item.id, item.data() as Record<string, unknown>));
  const resolved = resolveDay(date, [template], exceptions).find((shift) => shift.templateId === templateId);
  if (!resolved || resolved.userId !== caller.uid) {
    throw new HttpsError("permission-denied", "You can only request coverage for your own shift.");
  }
  const shiftId = shiftKey(templateId, date);
  const open = await db.collection("shiftRequests").where("shiftId", "==", shiftId).where("status", "==", "pending").limit(1).get();
  if (!open.empty) throw new HttpsError("failed-precondition", "There is already an open request for that shift.");
  const at = new Date().toISOString();
  const ref = await db.collection("shiftRequests").add({
    type,
    shiftId,
    templateId,
    shiftDate: date,
    shiftStart: resolved.start,
    shiftEnd: resolved.end,
    requesterId: caller.uid,
    requesterName: caller.displayName,
    status: "pending",
    acceptedBy: null,
    acceptedByName: null,
    patternUpdated: false,
    requestedAt: FieldValue.serverTimestamp(),
    resolvedAt: null,
    history: [{ action: "requested", uid: caller.uid, name: caller.displayName, at }],
  });
  await announceCoverage(caller, { action: "requested", type, date, start: resolved.start, end: resolved.end });
  return { id: ref.id };
});

type LoadedRequest = ShiftRequestRecord & {
  templateId: string;
  shiftDate: string;
  acceptedBy: string;
  acceptedByName: string;
  patternUpdated: boolean;
  shiftStart: string;
  shiftEnd: string;
};

async function loadRequest(id: string): Promise<LoadedRequest> {
  const snap = await db.doc(`shiftRequests/${id}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "That request was not found.");
  const status = snap.get("status");
  return {
    type: coverageKind(snap.get("type")) || "swap",
    shiftId: String(snap.get("shiftId") ?? ""),
    templateId: String(snap.get("templateId") ?? ""),
    shiftDate: String(snap.get("shiftDate") ?? ""),
    requesterId: String(snap.get("requesterId") ?? ""),
    status: status === "accepted" || status === "declined" || status === "cancelled" || status === "pending" ? status : "pending",
    acceptedBy: String(snap.get("acceptedBy") ?? ""),
    acceptedByName: String(snap.get("acceptedByName") ?? ""),
    patternUpdated: snap.get("patternUpdated") === true,
    shiftStart: String(snap.get("shiftStart") ?? ""),
    shiftEnd: String(snap.get("shiftEnd") ?? ""),
    history: (snap.get("history") as ShiftRequestRecord["history"]) || [],
  };
}

export const acceptShiftRequest = onCall(callable, async (request) => {
  const caller = await requireReadyUser(requireAuth(request));
  const id = String(asObject(request.data).id ?? "");
  if (!id) throw new HttpsError("invalid-argument", "Choose a request.");
  const current = await loadRequest(id);
  if (!current.templateId || !isIsoDate(current.shiftDate)) {
    throw new HttpsError("failed-precondition", "That request is not tied to a weekly shift.");
  }
  const templateRef = db.doc(`shiftTemplates/${current.templateId}`);
  const templateSnap = await templateRef.get();
  if (!templateSnap.exists) throw new HttpsError("not-found", "That weekly shift was not found.");
  const template = templateFromData(current.templateId, templateSnap.data() as Record<string, unknown>);
  const exceptionSnap = await db
    .collection("shiftExceptions")
    .where("templateId", "==", current.templateId)
    .where("date", "==", current.shiftDate)
    .get();
  const exceptions = exceptionSnap.docs.map((item) => exceptionFromData(item.id, item.data() as Record<string, unknown>));
  try {
    assertCoverageApproval(current.type, canManageSchedule(caller.role));
  } catch (error) {
    throw new HttpsError("permission-denied", error instanceof Error ? error.message : "Could not approve.");
  }
  const resolved = resolveDay(current.shiftDate, [template], exceptions).find((shift) => shift.templateId === current.templateId);
  if (!resolved) throw new HttpsError("not-found", "That shift was not found.");
  const shift: ShiftRecord = {
    userId: resolved.userId,
    userName: resolved.userName,
    date: current.shiftDate,
    start: resolved.start,
    end: resolved.end,
  };
  let next: ReturnType<typeof applyAcceptance>;
  try {
    next = applyAcceptance(shift, current, { uid: caller.uid, name: caller.displayName }, new Date().toISOString());
  } catch (error) {
    throw new HttpsError("failed-precondition", error instanceof Error ? error.message : "Could not accept.");
  }
  await db.runTransaction(async (tx) => {
    const requestRef = db.doc(`shiftRequests/${id}`);
    const freshRequest = await tx.get(requestRef);
    const freshTemplate = await tx.get(templateRef);
    const freshExceptions = await tx.get(
      db.collection("shiftExceptions").where("templateId", "==", current.templateId).where("date", "==", current.shiftDate),
    );
    if (!freshTemplate.exists) throw new HttpsError("not-found", "That weekly shift was not found.");
    if (freshRequest.get("status") !== "pending") {
      throw new HttpsError("failed-precondition", "That request is no longer open.");
    }
    const fresh = templateFromData(current.templateId, freshTemplate.data() as Record<string, unknown>);
    const freshList = freshExceptions.docs.map((item) => exceptionFromData(item.id, item.data() as Record<string, unknown>));
    const freshResolved = resolveDay(current.shiftDate, [fresh], freshList).find((item) => item.templateId === current.templateId);
    if (!freshResolved || freshResolved.userId !== current.requesterId) {
      throw new HttpsError("failed-precondition", "That shift has already changed.");
    }
    const existing = freshExceptions.docs.slice().sort((a, b) => a.id.localeCompare(b.id))[0];
    let write: "create" | "update";
    try {
      write = planCoverageWrite({
        templateUserId: fresh.userId,
        exceptionUserId: existing ? String(existing.get("userId") ?? "") : null,
        requesterId: current.requesterId,
      });
    } catch (error) {
      throw new HttpsError("failed-precondition", error instanceof Error ? error.message : "Could not accept.");
    }
    const kind = coverageKind(freshRequest.get("type")) || "swap";
    const assigneeId = isAwayKind(kind) ? current.requesterId : caller.uid;
    const assigneeName = isAwayKind(kind)
      ? freshResolved.userName || String(freshRequest.get("requesterName") ?? "")
      : caller.displayName;
    if (write === "update" && existing) {
      tx.update(existing.ref, {
        userId: assigneeId,
        userName: assigneeName,
        kind,
        requestId: id,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      tx.set(db.collection("shiftExceptions").doc(), {
        date: current.shiftDate,
        templateId: current.templateId,
        kind,
        userId: assigneeId,
        userName: assigneeName,
        start: fresh.start,
        end: fresh.end,
        requestId: id,
        createdBy: caller.uid,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    tx.update(requestRef, {
      status: "accepted",
      acceptedBy: caller.uid,
      acceptedByName: caller.displayName,
      resolvedAt: FieldValue.serverTimestamp(),
      history: next.request.history,
    });
  });
  await announceCoverage(caller, {
    action: "accepted",
    type: current.type,
    date: shift.date,
    start: shift.start,
    end: shift.end,
  });
  return { accepted: true };
});

export const makeWeeklyPattern = onCall(callable, async (request) => {
  const caller = await requireReadyUser(requireAuth(request));
  if (!canManageSchedule(caller.role)) {
    throw new HttpsError("permission-denied", "Only a team lead or admin can update the weekly pattern.");
  }
  const id = String(asObject(request.data).id ?? "");
  if (!id) throw new HttpsError("invalid-argument", "Choose a request.");
  const current = await loadRequest(id);
  if (current.type !== "swap" || current.status !== "accepted") {
    throw new HttpsError("failed-precondition", "Only an accepted swap can become the weekly pattern.");
  }
  if (current.patternUpdated) throw new HttpsError("failed-precondition", "That swap is already the weekly pattern.");
  if (!current.templateId || !current.acceptedBy) {
    throw new HttpsError("failed-precondition", "That request is not tied to a weekly shift.");
  }
  const templateRef = db.doc(`shiftTemplates/${current.templateId}`);
  const templateSnap = await templateRef.get();
  if (!templateSnap.exists) throw new HttpsError("not-found", "That weekly shift was not found.");
  await db.runTransaction(async (tx) => {
    const requestRef = db.doc(`shiftRequests/${id}`);
    const freshTemplate = await tx.get(templateRef);
    const freshRequest = await tx.get(requestRef);
    if (!freshTemplate.exists) throw new HttpsError("not-found", "That weekly shift was not found.");
    if (freshRequest.get("status") !== "accepted" || freshRequest.get("type") !== "swap") {
      throw new HttpsError("failed-precondition", "Only an accepted swap can become the weekly pattern.");
    }
    if (freshRequest.get("patternUpdated") === true) {
      throw new HttpsError("failed-precondition", "That swap is already the weekly pattern.");
    }
    const acceptorId = String(freshRequest.get("acceptedBy") ?? "");
    const acceptorName = String(freshRequest.get("acceptedByName") ?? "");
    if (!acceptorId) throw new HttpsError("failed-precondition", "That swap has no one to copy onto the weekly pattern.");
    let plan: ReturnType<typeof promoteSwap>;
    try {
      plan = promoteSwap({
        template: templateFromData(current.templateId, freshTemplate.data() as Record<string, unknown>),
        shiftDate: String(freshRequest.get("shiftDate") ?? ""),
        acceptorId,
        acceptorName,
        alreadyPromoted: false,
      });
    } catch (error) {
      throw new HttpsError("failed-precondition", error instanceof Error ? error.message : "Could not update the weekly pattern.");
    }
    const history = (freshRequest.get("history") as ShiftRequestRecord["history"]) || [];
    tx.update(templateRef, {
      effectiveUntil: plan.effectiveUntil,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.collection("shiftTemplates").doc(), {
      userId: plan.next.userId,
      userName: plan.next.userName,
      weekday: plan.next.weekday,
      start: plan.next.start,
      end: plan.next.end,
      effectiveFrom: plan.next.effectiveFrom,
      effectiveUntil: plan.next.effectiveUntil,
      createdBy: caller.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(requestRef, {
      patternUpdated: true,
      history: [...history, { action: "weekly pattern", uid: caller.uid, name: caller.displayName, at: new Date().toISOString() }],
    });
  });
  return { updated: true };
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
  await announceCoverage(caller, {
    action: "cancelled",
    type: current.type,
    date: current.shiftDate,
    start: current.shiftStart,
    end: current.shiftEnd,
  });
  return { cancelled: true };
});

async function announceCoverage(
  sender: { uid: string; displayName: string },
  notice: CoverageNotice,
): Promise<void> {
  if (!notice.date || !notice.start || !notice.end) return;
  const text = coverageMessageText(notice);
  const parent = db.doc("groupThread/main");
  const message = parent.collection("messages").doc();
  const batch = db.batch();
  batch.set(message, {
    senderId: sender.uid,
    senderName: sender.displayName,
    text,
    kind: "coverage",
    coverageType: notice.type,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(
    parent,
    {
      type: "group",
      title: "Care team",
      lastMessageText: messagePreview(text, false),
      lastMessageAt: FieldValue.serverTimestamp(),
      lastSenderId: sender.uid,
      lastSenderName: sender.displayName,
    },
    { merge: true },
  );
  await batch.commit();
}

async function notifyMessage(
  senderId: string,
  senderName: string,
  text: string,
  hasImage: boolean,
  threadId: string,
  directParticipantIds?: string[],
  audience: "care" | "notice" | "coverage" = "care",
): Promise<void> {
  const users = await loadActiveUsers();
  const shown = messagePreview(text, hasImage);
  const preview = shown.length > 120 ? `${shown.slice(0, 117)}...` : shown;
  const groupRecipients =
    audience === "care" ? careTeamRecipients(users, senderId) : audience === "coverage" ? coverageRecipients(users, senderId) : messageRecipients(users, senderId);
  const recipients = directParticipantIds
    ? directRecipients(users, senderId, directParticipantIds)
    : groupRecipients.map((user) => user.uid);
  const sender = users.find((user) => user.uid === senderId);
  const title = withEmoji(senderName || "New message", sender?.emoji);
  await sendVisiblePush(db, messaging, recipients, {
    title,
    body: preview,
    link: `/?view=messages&thread=${encodeURIComponent(threadId)}`,
    data: { type: "message", threadId, title, body: preview },
  });
}

export const onGroupMessage = onDocumentCreated("groupThread/{docId}/messages/{messageId}", async (event) => {
  if (event.params.docId !== "main" || !event.data) return;
  const data = event.data.data();
  await notifyMessage(
    String(data.senderId || ""),
    String(data.senderName || ""),
    String(data.text || ""),
    typeof data.imagePath === "string" && data.imagePath.length > 0,
    "group",
    undefined,
    data.kind === "coverage" ? "coverage" : data.notice === true ? "notice" : "care",
  );
});

export const deleteMessage = onCall(callable, async (request) => {
  const caller = await requireReadyUser(requireAuth(request));
  const body = asObject(request.data);
  const thread = String(body.thread ?? "");
  const messageId = String(body.messageId ?? "");
  if (!thread || !messageId || thread.includes("/") || messageId.includes("/")) {
    throw new HttpsError("invalid-argument", "Choose a message.");
  }
  const group = thread === "group";
  if (!group && !thread.startsWith("direct_")) throw new HttpsError("invalid-argument", "Choose a message.");
  const parentRef = group ? db.doc("groupThread/main") : db.doc(`threads/${thread}`);
  const messageRef = parentRef.collection("messages").doc(messageId);
  if (!group) {
    const parent = await parentRef.get();
    if (!parent.exists || parent.get("type") !== "direct") throw new HttpsError("not-found", "That message was not found.");
    const participants = (parent.get("participantIds") as string[]) || [];
    const admin = caller.role === "super_admin" || caller.role === "admin";
    if (!admin && !participants.includes(caller.uid)) {
      throw new HttpsError("permission-denied", "You cannot open that message.");
    }
  }
  const message = await messageRef.get();
  if (!message.exists) throw new HttpsError("not-found", "That message was not found.");
  const senderId = String(message.get("senderId") || "");
  if (!canDeleteMessage(caller.role, caller.uid, senderId)) {
    throw new HttpsError("permission-denied", "Only the sender or an admin can delete this message.");
  }
  const parentBefore = group ? await parentRef.get() : null;
  const wasNotice = group && String(parentBefore?.get("noticeMessageId") || "") === messageId;
  await messageRef.delete();
  const remaining = await parentRef.collection("messages").orderBy("createdAt", "desc").limit(1).get();
  const update: Record<string, unknown> = remaining.empty
    ? {
        lastMessageText: "",
        lastSenderId: "",
        lastSenderName: "",
        lastMessageAt: FieldValue.serverTimestamp(),
      }
    : {
        lastMessageText: messagePreview(
          String(remaining.docs[0].get("text") || ""),
          typeof remaining.docs[0].get("imagePath") === "string" && String(remaining.docs[0].get("imagePath")).length > 0,
        ),
        lastSenderId: String(remaining.docs[0].get("senderId") || ""),
        lastSenderName: String(remaining.docs[0].get("senderName") || ""),
        lastMessageAt: remaining.docs[0].get("createdAt") || FieldValue.serverTimestamp(),
      };
  if (group && (wasNotice || remaining.empty)) {
    const nextNotice = remaining.empty
      ? null
      : (
          await parentRef.collection("messages").where("notice", "==", true).orderBy("createdAt", "desc").limit(1).get()
        ).docs[0];
    update.noticeMessageId = nextNotice?.id || "";
    update.noticeText = nextNotice ? String(nextNotice.get("text") || "") : "";
    update.noticeSenderId = nextNotice ? String(nextNotice.get("senderId") || "") : "";
    update.noticeSenderName = nextNotice ? String(nextNotice.get("senderName") || "") : "";
    update.noticeImagePath = nextNotice ? String(nextNotice.get("imagePath") || "") : "";
    update.noticeAt = nextNotice?.get("createdAt") || FieldValue.serverTimestamp();
  }
  await parentRef.update(update);
  return { deleted: true };
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
    typeof data.imagePath === "string" && data.imagePath.length > 0,
    event.params.threadId,
    participantIds,
  );
});
