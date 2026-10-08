import { describe, expect, it } from "vitest";
import { isSingleEmoji, normalizeEmoji, PROFILE_EMOJI, withEmoji } from "../functions/src/logic/emoji";
import { insertText } from "../src/messageText";
import { isSingleEmoji as clientIsSingleEmoji, PROFILE_EMOJI as clientEmoji, withEmoji as clientWithEmoji } from "../src/profileEmoji";

describe("employee emoji", () => {
  it("offers the same care list on the server and the phone", () => {
    expect(PROFILE_EMOJI).toEqual(clientEmoji);
    expect(new Set(PROFILE_EMOJI).size).toBe(40);
  });

  it("keeps one listed emoji and clears a blank value", () => {
    expect(normalizeEmoji("😊")).toEqual({ ok: true, emoji: "😊" });
    expect(normalizeEmoji("  👍 ")).toEqual({ ok: true, emoji: "👍" });
    expect(normalizeEmoji("")).toEqual({ ok: true, emoji: "" });
    expect(normalizeEmoji("   ")).toEqual({ ok: true, emoji: "" });
  });

  it("accepts one emoji from the keyboard", () => {
    for (const mark of ["🌻", "👍🏽", "👩‍⚕️", "🇺🇸", "❤️", "1️⃣"]) {
      expect(isSingleEmoji(mark)).toBe(true);
      expect(clientIsSingleEmoji(mark)).toBe(true);
      expect(normalizeEmoji(`  ${mark}  `)).toEqual({ ok: true, emoji: mark });
    }
  });

  it("rejects words, digits, and more than one emoji", () => {
    for (const mark of ["Alex", "1", "#", "*", "😊😊", "hi 😊"]) {
      expect(isSingleEmoji(mark)).toBe(false);
      expect(clientIsSingleEmoji(mark)).toBe(false);
      expect(normalizeEmoji(mark)).toEqual({ ok: false, reason: "Choose an emoji." });
    }
  });

  it("inserts one emoji into a plain message", () => {
    expect(insertText("Hello", 5, 5, "🌸")).toEqual({ value: "Hello🌸", cursor: 7 });
    expect(insertText("Hi there", 2, 2, "💗")).toEqual({ value: "Hi💗 there", cursor: 4 });
    expect(insertText("🌸", 0, 0, "🌷")).toEqual({ value: "🌷🌸", cursor: 2 });
    expect(insertText("a".repeat(2000), 2000, 2000, "🌸").value).toHaveLength(2000);
  });

  it("shows the chosen emoji or a plain initial beside the name", () => {
    expect(withEmoji("Alex", "😊")).toBe("😊 Alex");
    expect(withEmoji("Alex", "")).toBe("A Alex");
    expect(withEmoji("Alex")).toBe("A Alex");
    expect(withEmoji("Alex", "🌻")).toBe("🌻 Alex");
    expect(withEmoji("  ", "nope")).toBe("?");
    expect(clientWithEmoji("Sam", "🦊")).toBe("🦊 Sam");
  });
});