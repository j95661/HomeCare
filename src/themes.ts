export const COLOR_SCHEMES = [
  { id: "sky", label: "Sky", accent: "#0277bd" },
  { id: "rose", label: "Rose", accent: "#7a2948" },
  { id: "blush", label: "Blush", accent: "#8e3454" },
  { id: "lilac", label: "Lilac", accent: "#64357f" },
  { id: "berry", label: "Berry", accent: "#6e2344" },
  { id: "plum", label: "Plum", accent: "#f0a8c0" },
] as const;

export type ColorSchemeId = (typeof COLOR_SCHEMES)[number]["id"];

export const DEFAULT_COLOR_SCHEME: ColorSchemeId = "sky";

/** Chart swatches a person can apply to their own screen. */
export const COLOR_CHART = [
  "#7a2948",
  "#8e3454",
  "#a34b6b",
  "#c45c7a",
  "#e8a0b0",
  "#6e2344",
  "#8c3a55",
  "#b56b4a",
  "#c4a35a",
  "#f0a8c0",
  "#64357f",
  "#7a4e78",
  "#5c3d6e",
  "#4a3060",
  "#9b6b9a",
  "#2f6f6a",
  "#6b8f71",
  "#3d5a80",
  "#0277bd",
  "#fbdf22",
  "#8c4a3a",
  "#f4c2d0",
] as const;

const THEME_VARS = [
  "--bg",
  "--ink",
  "--panel",
  "--line",
  "--accent",
  "--on-accent",
  "--ok",
  "--off",
  "--warn",
  "--muted",
  "--focus",
  "--mine",
  "--glow",
] as const;

export type Palette = {
  dark: boolean;
  vars: Record<(typeof THEME_VARS)[number], string>;
};

export function isColorScheme(value: string): value is ColorSchemeId {
  return COLOR_SCHEMES.some((scheme) => scheme.id === value);
}

export function resolveColorScheme(value: string): ColorSchemeId {
  return isColorScheme(value) ? value : DEFAULT_COLOR_SCHEME;
}

export function parseCustomColor(value: string): string | null {
  const match = /^custom:(#[0-9a-f]{6})$/.exec(value.trim().toLowerCase());
  return match ? match[1] : null;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((channel) => clamp(channel).toString(16).padStart(2, "0")).join("")}`;
}

function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b] = hexToRgb(hex);
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  };
  const left = lum(a);
  const right = lum(b);
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

function mix(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * amount, ag + (bg - ag) * amount, ab + (bb - ab) * amount);
}

function readable(start: string, background: string, toward: string): string {
  let current = start;
  for (let step = 0; step < 16; step += 1) {
    if (contrastRatio(current, background) >= 4.5) return current;
    current = mix(current, toward, 0.35);
  }
  return contrastRatio(toward, background) >= contrastRatio(current, background) ? toward : current;
}

function onAccent(accent: string): string {
  const light = "#ffffff";
  const dark = "#1a0a10";
  return contrastRatio(accent, light) >= contrastRatio(accent, dark) ? light : dark;
}

/** Nudge a mid-tone accent just enough that the button label stays readable. */
function accentForText(accent: string): { accent: string; on: string } {
  let color = accent;
  for (let step = 0; step < 16; step += 1) {
    const text = onAccent(color);
    if (contrastRatio(color, text) >= 4.5) return { accent: color, on: text };
    color = mix(color, text === "#ffffff" ? "#000000" : "#ffffff", 0.12);
  }
  const text = onAccent(color);
  return { accent: color, on: text };
}

/** Build a light or dark theme around one accent, with ink and button text kept readable. */
export function buildPalette(accent: string): Palette {
  const picked = accentForText(accent.toLowerCase());
  const color = picked.accent;
  const dark = luminanceIsLight(accent.toLowerCase());
  const textOnAccent = picked.on;
  if (dark) {
    const bg = mix(color, "#12080c", 0.84);
    const panel = mix(color, "#1c1016", 0.72);
    const ink = readable("#fbeef3", bg, "#ffffff");
    return {
      dark: true,
      vars: {
        "--bg": bg,
        "--ink": ink,
        "--panel": panel,
        "--line": mix(color, "#fbeef3", 0.38),
        "--accent": color,
        "--on-accent": textOnAccent,
        "--ok": "#0e7a45",
        "--off": "#7a3e55",
        "--warn": "#9c1d3a",
        "--muted": readable(mix(ink, color, 0.28), bg, "#ffffff"),
        "--focus": mix(color, "#ffffff", 0.35),
        "--mine": mix(color, "#12080c", 0.5),
        "--glow": mix(color, "#12080c", 0.35),
      },
    };
  }
  const bg = mix(color, "#fff8f9", 0.9);
  const panel = "#fffdfd";
  const ink = readable(mix(color, "#2c1220", 0.55), bg, "#1a0a10");
  return {
    dark: false,
    vars: {
      "--bg": bg,
      "--ink": ink,
      "--panel": panel,
      "--line": mix(color, "#ffffff", 0.28),
      "--accent": color,
      "--on-accent": textOnAccent,
      "--ok": "#0e7a45",
      "--off": mix(color, "#4a2030", 0.45),
      "--warn": "#9c1d3a",
      "--muted": readable(mix(ink, color, 0.2), bg, "#1a0a10"),
      "--focus": mix(color, "#3a1060", 0.4),
      "--mine": mix(color, "#ffffff", 0.84),
      "--glow": mix(color, "#ffffff", 0.68),
    },
  };
}

function luminanceIsLight(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  const lum = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  return lum > 0.45;
}

export function applyTheme(value: string): void {
  const root = document.documentElement;
  const custom = parseCustomColor(value);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (custom) {
    const palette = buildPalette(custom);
    root.dataset.theme = "custom";
    root.style.colorScheme = palette.dark ? "dark" : "light";
    for (const key of THEME_VARS) root.style.setProperty(key, palette.vars[key]);
    meta?.setAttribute("content", palette.vars["--accent"]);
    return;
  }
  root.style.colorScheme = "";
  for (const key of THEME_VARS) root.style.removeProperty(key);
  const id = resolveColorScheme(value);
  root.dataset.theme = id;
  const accent = COLOR_SCHEMES.find((scheme) => scheme.id === id)?.accent ?? COLOR_SCHEMES[0].accent;
  meta?.setAttribute("content", accent);
}
