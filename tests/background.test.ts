import { describe, expect, it } from "vitest";
import { isOwnBackgroundPath } from "../src/backgroundPath";

describe("personal background", () => {
  it("accepts a blank path or a file under that person's folder", () => {
    expect(isOwnBackgroundPath("pat", "")).toBe(true);
    expect(isOwnBackgroundPath("pat", "backgrounds/pat/p1abc.jpg")).toBe(true);
    expect(isOwnBackgroundPath("pat", "backgrounds/pat/photo.webp")).toBe(true);
  });

  it("rejects another person's file and other folders", () => {
    expect(isOwnBackgroundPath("pat", "backgrounds/sam/p1abc.jpg")).toBe(false);
    expect(isOwnBackgroundPath("pat", "handover/pat/p1abc.jpg")).toBe(false);
    expect(isOwnBackgroundPath("pat", "backgrounds/pat/../sam/p1.jpg")).toBe(false);
    expect(isOwnBackgroundPath("pat", "backgrounds/pat/nested/p1.jpg")).toBe(false);
    expect(isOwnBackgroundPath("pat", "backgrounds/pat/")).toBe(false);
  });
});
