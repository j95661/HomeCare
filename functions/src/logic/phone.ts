/** Optional US mobile number. Blank stays blank. Ten digits, or eleven with a leading 1, become (415) 555-0100. */
export function normalizePhone(value: unknown): { ok: true; phone: string } | { ok: false; reason: string } {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: true, phone: "" };
  const digits = raw.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return { ok: false, reason: "Enter a mobile number like (415) 555-0100." };
  return { ok: true, phone: `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}` };
}
