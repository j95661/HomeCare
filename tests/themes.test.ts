import { describe, expect, it } from "vitest";
import { COLOR_SCHEME_IDS, DEFAULT_COLOR_SCHEME, isColorScheme, normalizePersonalColorScheme } from "../functions/src/logic/themes";
import { COLOR_CHART, COLOR_SCHEMES, buildPalette, contrastRatio, isColorScheme as clientIsColorScheme } from "../src/themes";

describe("color schemes", () => {
  it("offers the same schemes on the server and the screen", () => {
    expect(COLOR_SCHEMES.map((scheme) => scheme.id)).toEqual([...COLOR_SCHEME_IDS]);
    expect(DEFAULT_COLOR_SCHEME).toBe("rose");
    expect(isColorScheme("plum")).toBe(true);
    expect(isColorScheme("forest")).toBe(false);
    expect(clientIsColorScheme("lilac")).toBe(true);
    expect(clientIsColorScheme("")).toBe(false);
  });

  it("lets a person choose a scheme or follow the team default", () => {
    expect(normalizePersonalColorScheme("")).toEqual({ ok: true, colorScheme: "" });
    expect(normalizePersonalColorScheme("  ")).toEqual({ ok: true, colorScheme: "" });
    expect(normalizePersonalColorScheme("berry")).toEqual({ ok: true, colorScheme: "berry" });
    expect(normalizePersonalColorScheme("custom:#a34b6b")).toEqual({ ok: true, colorScheme: "custom:#a34b6b" });
    expect(normalizePersonalColorScheme("#AABBCC")).toEqual({ ok: true, colorScheme: "custom:#aabbcc" });
    expect(normalizePersonalColorScheme("forest")).toEqual({ ok: false, reason: "Choose a color." });
    expect(normalizePersonalColorScheme("custom:#gg0000")).toEqual({ ok: false, reason: "Choose a color." });
  });

  it("keeps chart colors readable against the page and the buttons", () => {
    const samples = [...COLOR_CHART, "#ffffff", "#000000", "#777777", "#f4c2d0"];
    for (const hex of samples) {
      const palette = buildPalette(hex);
      expect(contrastRatio(palette.vars["--ink"], palette.vars["--bg"])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.vars["--on-accent"], palette.vars["--accent"])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio("#ffffff", palette.vars["--ok"])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio("#ffffff", palette.vars["--warn"])).toBeGreaterThanOrEqual(4.5);
    }
  });
});
