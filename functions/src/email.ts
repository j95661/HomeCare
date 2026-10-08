import nodemailer from "nodemailer";
import { logger } from "firebase-functions";
import { HttpsError } from "firebase-functions/v2/https";
import { isEmulator } from "./lib";

function siteUrl(): string {
  return process.env.HOMECARE_WEB_URL || "https://hammondcare-ce36f.web.app";
}

export async function sendWelcomeEmail(email: string, displayName: string, signIn: string): Promise<void> {
  const url = siteUrl();
  const how = signIn === "google" ? "Sign in with Gmail. No password is set." : "Sign in with an email code. No password is set.";
  const text = `Hello ${displayName},\n\nYour HammondCare account is ready.\n\n${url}\n\n${how}\n`;
  const host = process.env.SMTP_HOST;
  if (!host) {
    if (isEmulator()) {
      logger.info(`Emulator welcome for ${email}: ${url}`);
      return;
    }
    throw new HttpsError("failed-precondition", "Email is not configured on the server.");
  }
  await deliver(email, "Your HammondCare link", text);
}

export async function sendOtpEmail(email: string, code: string): Promise<void> {
  const host = process.env.SMTP_HOST;
  if (!host) {
    if (isEmulator()) {
      logger.info(`Emulator sign-in code for ${email}: ${code}`);
      return;
    }
    throw new HttpsError("failed-precondition", "Email is not configured on the server.");
  }
  await deliver(email, "Your HammondCare sign-in code", `Your HammondCare sign-in code is ${code}. It expires in 10 minutes.`);
}

async function deliver(email: string, subject: string, text: string): Promise<void> {
  const host = process.env.SMTP_HOST;
  if (!host) throw new HttpsError("failed-precondition", "Email is not configured on the server.");
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
  await transport.sendMail({ from, to: email, subject, text });
}
