import { describe, expect, it } from "vitest";
import { normalizeEmoji, withEmoji } from "../functions/src/logic/emoji";
import { insertText } from "../src/messageText";

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

  it("inserts one emoji into a plain message", () => {
    expect(insertText("Hello", 5, 5, "🌸")).toEqual({ value: "Hello🌸", cursor: 7 });
    expect(insertText("Hi there", 2, 2, "💗")).toEqual({ value: "Hi💗 there", cursor: 4 });
    expect(insertText("🌸", 0, 0, "🌷")).toEqual({ value: "🌷🌸", cursor: 2 });
    expect(insertText("a".repeat(2000), 2000, 2000, "🌸").value).toHaveLength(2000);
  });

  it("prefixes a name only when an emoji is set", () => {
    expect(withEmoji("Alex", "🌻")).toBe("🌻 Alex");
    expect(withEmoji("Alex", "")).toBe("Alex");
    expect(withEmoji("Alex")).toBe("Alex");
  });
});