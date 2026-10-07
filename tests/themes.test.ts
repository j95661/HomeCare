import { describe, expect, it } from "vitest";
import { COLOR_SCHEME_IDS, DEFAULT_COLOR_SCHEME, isColorScheme } from "../functions/src/logic/themes";
import { COLOR_SCHEMES, isColorScheme as clientIsColorScheme } from "../src/themes";

describe("color schemes", () => {
  it("offers the same schemes on the server and the screen", () => {
    expect(COLOR_SCHEMES.map((scheme) => scheme.id)).toEqual([...COLOR_SCHEME_IDS]);
    expect(DEFAULT_COLOR_SCHEME).toBe("forest");
    expect(isColorScheme("night")).toBe(true);
    expect(isColorScheme("purple")).toBe(false);
    expect(clientIsColorScheme("clay")).toBe(true);
    expect(clientIsColorScheme("")).toBe(false);
  });
});
