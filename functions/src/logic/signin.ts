import { isPasswordExpired } from "./password";

export const NEW_SIGN_IN_METHODS = ["google", "email_otp"] as const;
export type NewSignInMethod = (typeof NEW_SIGN_IN_METHODS)[number];
export type SignInMethod = "password" | NewSignInMethod;

export function isNewSignInMethod(value: unknown): value is NewSignInMethod {
  return value === "google" || value === "email_otp";
}

/** Missing or unknown values stay on password so existing accounts keep that sign-in. */
export function normalizeSignIn(value: unknown): SignInMethod {
  return isNewSignInMethod(value) ? value : "password";
}

export function needsPasswordChange(
  signIn: unknown,
  active: boolean,
  otpVerified: boolean,
  expires: Date,
  now: Date,
): boolean {
  if (normalizeSignIn(signIn) !== "password") return false;
  if (!active || !otpVerified) return false;
  return isPasswordExpired(expires, now);
}
