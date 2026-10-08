export const adminSignInCodeMessage = "Ask an admin for a sign-in code.";

/** Without mail, Gmail people sign in on the site. An email-code person gets a code from the admin. */
export function welcomeDelivery(signIn: string, smtpConfigured: boolean, emulator: boolean): "send" | "skip" | "block" {
  if (smtpConfigured || emulator) return "send";
  if (signIn === "google" || signIn === "email_otp") return "skip";
  return "block";
}

export function signInCodeNote(code: string, justEnabled = false): string {
  const start = justEnabled ? "Enabled. " : "";
  return `${start}Sign-in code: ${code}. It expires in 10 minutes. They open HammondCare, choose Email code, and enter it.`;
}
