export const COLOR_SCHEME_IDS = ["forest", "night", "ocean", "clay"] as const;
export type ColorSchemeId = (typeof COLOR_SCHEME_IDS)[number];

export const DEFAULT_COLOR_SCHEME: ColorSchemeId = "forest";

export function isColorScheme(value: unknown): value is ColorSchemeId {
  return typeof value === "string" && (COLOR_SCHEME_IDS as readonly string[]).includes(value);
}

/** A blank value means this person follows the team color scheme. */
export function normalizePersonalColorScheme(
  value: unknown,
): { ok: true; colorScheme: ColorSchemeId | "" } | { ok: false; reason: string } {
  if (value == null || String(value).trim() === "") return { ok: true, colorScheme: "" };
  const text = String(value).trim();
  if (!isColorScheme(text)) return { ok: false, reason: "Choose a color scheme." };
  return { ok: true, colorScheme: text };
}
