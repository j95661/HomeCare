/** Gmail people can be enabled without mail. An email-code account cannot. */
export function welcomeDelivery(signIn: string, smtpConfigured: boolean, emulator: boolean): "send" | "skip" | "block" {
  if (smtpConfigured || emulator) return "send";
  if (signIn === "google") return "skip";
  return "block";
}
