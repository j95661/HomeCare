import nodemailer from "nodemailer";
import { logger } from "firebase-functions";
import { HttpsError } from "firebase-functions/v2/https";
import { isEmulator } from "./lib";

export async function sendOtpEmail(email: string, code: string): Promise<void> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    if (isEmulator()) {
      logger.info(`Emulator sign-in code for ${email}: ${code}`);
      return;
    }
    throw new HttpsError("failed-precondition", "Email is not configured on the server.");
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  if (!from) throw new HttpsError("failed-precondition", "Email is not configured on the server.");

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
  });
  await transport.sendMail({
    from,
    to: email,
    subject: "Your HammondCare sign-in code",
    text: `Your HammondCare sign-in code is ${code}. It expires in 10 minutes.`,
  });
}
