import { describe, expect, it } from "vitest";
import { COLOR_SCHEME_IDS, DEFAULT_COLOR_SCHEME, isColorScheme, normalizePersonalColorScheme } from "../functions/src/logic/themes";
import { COLOR_SCHEMES, isColorScheme as clientIsColorScheme } from "../src/themes";

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
    expect(normalizePersonalColorScheme("forest")).toEqual({ ok: false, reason: "Choose a color scheme." });
  });
});
