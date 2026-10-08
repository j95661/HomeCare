export const COLOR_SCHEMES = [
  { id: "rose", label: "Rose", accent: "#7a2948" },
  { id: "blush", label: "Blush", accent: "#8e3454" },
  { id: "lilac", label: "Lilac", accent: "#64357f" },
  { id: "berry", label: "Berry", accent: "#6e2344" },
  { id: "plum", label: "Plum", accent: "#f0a8c0" },
] as const;

export type ColorSchemeId = (typeof COLOR_SCHEMES)[number]["id"];

export const DEFAULT_COLOR_SCHEME: ColorSchemeId = "rose";

export function isColorScheme(value: string): value is ColorSchemeId {
  return COLOR_SCHEMES.some((scheme) => scheme.id === value);
}

export function resolveColorScheme(value: string): ColorSchemeId {
  return isColorScheme(value) ? value : DEFAULT_COLOR_SCHEME;
}

export function applyTheme(value: string): void {
  const id = resolveColorScheme(value);
  document.documentElement.dataset.theme = id;
  const accent = COLOR_SCHEMES.find((scheme) => scheme.id === id)?.accent ?? "#7a2948";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", accent);
}
