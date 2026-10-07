import { describe, expect, it } from "vitest";
import { normalizeEmoji, withEmoji } from "../functions/src/logic/emoji";

describe("employee emoji", () => {
  it("keeps one emoji and clears a blank value", () => {
    expect(normalizeEmoji("🌻")).toEqual({ ok: true, emoji: "🌻" });
    expect(normalizeEmoji("  ☕ ")).toEqual({ ok: true, emoji: "☕" });
    expect(normalizeEmoji("")).toEqual({ ok: true, emoji: "" });
    expect(normalizeEmoji("   ")).toEqual({ ok: true, emoji: "" });
    expect(normalizeEmoji("👍🏽")).toEqual({ ok: true, emoji: "👍🏽" });
    expect(normalizeEmoji("👩‍⚕️")).toEqual({ ok: true, emoji: "👩‍⚕️" });
    expect(normalizeEmoji("🇺🇸")).toEqual({ ok: true, emoji: "🇺🇸" });
  });

  it("rejects words, several emoji, and a long string", () => {
    expect(normalizeEmoji("Alex")).toEqual({ ok: false, reason: "Choose an emoji." });
    expect(normalizeEmoji("🌻🌻")).toEqual({ ok: false, reason: "Choose one emoji." });
    expect(normalizeEmoji("hi 🌻")).toEqual({ ok: false, reason: "Choose an emoji." });
    expect(normalizeEmoji("🌻".repeat(20))).toEqual({ ok: false, reason: "Choose one emoji." });
  });

  it("prefixes a name only when an emoji is set", () => {
    expect(withEmoji("Alex", "🌻")).toBe("🌻 Alex");
    expect(withEmoji("Alex", "")).toBe("Alex");
    expect(withEmoji("Alex")).toBe("Alex");
  });
});