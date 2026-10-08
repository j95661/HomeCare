import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import { actingAsUid, COVERAGE_ACT_CALLS, viewOnlyError, withActingEmployee } from "./viewAs";

const OWN_ACCOUNT_CALLS = new Set([
  "getSessionState",
  "acceptGoogleSignIn",
  "requestEmailOtp",
  "verifyEmailOtp",
  "requestSignInCode",
  "verifySignInCode",
  "changePassword",
]);

export async function call<T>(name: string, data?: object): Promise<T> {
  const blocked = viewOnlyError();
  if (blocked && !OWN_ACCOUNT_CALLS.has(name) && !COVERAGE_ACT_CALLS.has(name)) throw new Error(blocked);
  const fn = httpsCallable(functions, name);
  const result = await fn(withActingEmployee(name, data, actingAsUid()));
  return result.data as T;
}

export function errorText(error: unknown): string {
  const message =
    error && typeof error === "object" && "message" in error ? String((error as { message: string }).message || "") : "";
  if (/failed to fetch|network request failed|internal/i.test(message)) {
    return "Can't reach HammondCare services. If this is a local install, start the Firebase emulators and try again.";
  }
  return message || "Something went wrong.";
}

export function authError(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
    return "Email or password is incorrect.";
  }
  if (code === "auth/user-disabled") return "This account has been revoked.";
  if (code === "auth/too-many-requests") return "Too many attempts. Wait and try again.";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "Sign-in was cancelled.";
  if (code === "auth/account-exists-with-different-credential") {
    return "That email already uses a password. Sign in with the password instead.";
  }
  return errorText(error);
}

export function isPermissionDenied(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "";
  return code.includes("permission-denied");
}
