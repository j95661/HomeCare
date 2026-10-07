export const COLOR_SCHEMES = [
  { id: "forest", label: "Forest", accent: "#0c3b2e" },
  { id: "night", label: "Night", accent: "#1f6b52" },
  { id: "ocean", label: "Ocean", accent: "#0b3a5b" },
  { id: "clay", label: "Clay", accent: "#7a3418" },
] as const;

export type ColorSchemeId = (typeof COLOR_SCHEMES)[number]["id"];

export function isColorScheme(value: string): value is ColorSchemeId {
  return COLOR_SCHEMES.some((scheme) => scheme.id === value);
}

export function applyTheme(value: string): void {
  const id: ColorSchemeId = isColorScheme(value) ? value : "forest";
  document.documentElement.dataset.theme = id;
  const accent = COLOR_SCHEMES.find((scheme) => scheme.id === id)?.accent ?? "#0c3b2e";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", accent);
}
