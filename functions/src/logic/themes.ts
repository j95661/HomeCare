export const COLOR_SCHEME_IDS = ["sky", "rose", "blush", "lilac", "berry", "plum"] as const;
export type ColorSchemeId = (typeof COLOR_SCHEME_IDS)[number];

export const DEFAULT_COLOR_SCHEME: ColorSchemeId = "sky";

const CUSTOM_COLOR = /^custom:#[0-9a-f]{6}$/;
const RAW_COLOR = /^#[0-9a-f]{6}$/;

export function isColorScheme(value: unknown): value is ColorSchemeId {
  return typeof value === "string" && (COLOR_SCHEME_IDS as readonly string[]).includes(value);
}

/** A blank value follows the team scheme. A chart color is stored as custom:#rrggbb. */
export function normalizePersonalColorScheme(
  value: unknown,
): { ok: true; colorScheme: string } | { ok: false; reason: string } {
  if (value == null || String(value).trim() === "") return { ok: true, colorScheme: "" };
  const text = String(value).trim().toLowerCase();
  if (isColorScheme(text)) return { ok: true, colorScheme: text };
  if (CUSTOM_COLOR.test(text)) return { ok: true, colorScheme: text };
  if (RAW_COLOR.test(text)) return { ok: true, colorScheme: `custom:${text}` };
  return { ok: false, reason: "Choose a color." };
}
