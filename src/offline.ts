import type { Session } from "./types";
import { resolveColorScheme } from "./themes";

const ROLES = new Set(["super_admin", "admin", "team_lead", "care_provider"]);

export function sessionCacheKey(uid: string): string {
  return `homecare-session:${uid}`;
}

export function writeCachedSession(storage: Pick<Storage, "setItem">, session: Session): void {
  storage.setItem(sessionCacheKey(session.uid), JSON.stringify(session));
}

export function readCachedSession(storage: Pick<Storage, "getItem">, uid: string): Session | null {
  if (!uid) return null;
  return parseCachedSession(storage.getItem(sessionCacheKey(uid)), uid);
}

export function parseCachedSession(raw: string | null, uid: string): Session | null {
  if (!raw || !uid) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (row.uid !== uid || typeof row.role !== "string" || !ROLES.has(row.role)) return null;
  if (typeof row.displayName !== "string" || typeof row.timezone !== "string" || !row.timezone) return null;
  return {
    uid,
    email: typeof row.email === "string" ? row.email : "",
    role: row.role as Session["role"],
    displayName: row.displayName,
    emoji: typeof row.emoji === "string" ? row.emoji : "",
    onShift: row.onShift === true,
    timezone: row.timezone,
    snoozeMinutes: typeof row.snoozeMinutes === "number" ? row.snoozeMinutes : 10,
    passwordMaxAgeDays: typeof row.passwordMaxAgeDays === "number" ? row.passwordMaxAgeDays : 90,
    colorScheme: resolveColorScheme(typeof row.colorScheme === "string" ? row.colorScheme : ""),
    personalColorScheme: typeof row.personalColorScheme === "string" ? row.personalColorScheme : "",
    backgroundImage: typeof row.backgroundImage === "string" ? row.backgroundImage : "",
  };
}

export function errorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return String((error as { code: unknown }).code || "");
}

export function errorMessage(error: unknown): string {
  if (!error || typeof error !== "object" || !("message" in error)) return "";
  return String((error as { message: unknown }).message || "");
}

/** True when the failure is a lost connection, so a saved session can stay on screen. */
export function isReachabilityError(error: unknown): boolean {
  const code = errorCode(error);
  const message = errorMessage(error);
  if (/unavailable|deadline-exceeded|cancelled|network-request-failed/i.test(code)) return true;
  if (/functions\/internal/i.test(code) && /internal|failed to fetch|network/i.test(message)) return true;
  return /failed to fetch|network request failed|network error|client is offline|load failed|offline/i.test(message);
}

export function shouldRestoreCachedSession(error: unknown, online: boolean): boolean {
  if (!online) return true;
  return isReachabilityError(error);
}
