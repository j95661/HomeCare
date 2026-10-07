export const COLOR_SCHEME_IDS = ["forest", "night", "ocean", "clay"] as const;
export type ColorSchemeId = (typeof COLOR_SCHEME_IDS)[number];

export const DEFAULT_COLOR_SCHEME: ColorSchemeId = "forest";

export function isColorScheme(value: unknown): value is ColorSchemeId {
  return typeof value === "string" && (COLOR_SCHEME_IDS as readonly string[]).includes(value);
}
