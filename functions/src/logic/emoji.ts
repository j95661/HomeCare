const EMOJI = /\p{Extended_Pictographic}/u;
const FLAG = /^\p{Regional_Indicator}{2}$/u;

export function withEmoji(name: string, emoji?: string): string {
  const mark = (emoji ?? "").trim();
  return mark ? `${mark} ${name}` : name;
}

/** Empty clears the emoji. Anything else must be a single emoji grapheme. */
export function normalizeEmoji(input: string): { ok: true; emoji: string } | { ok: false; reason: string } {
  const value = input.trim();
  if (!value) return { ok: true, emoji: "" };
  if (value.length > 32) return { ok: false, reason: "Choose one emoji." };
  const parts = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].map((part) => part.segment);
  if (parts.length !== 1) {
    const onlyEmoji = parts.every((part) => EMOJI.test(part) || FLAG.test(part));
    return { ok: false, reason: onlyEmoji ? "Choose one emoji." : "Choose an emoji." };
  }
  const grapheme = parts[0];
  if (!EMOJI.test(grapheme) && !FLAG.test(grapheme)) return { ok: false, reason: "Choose an emoji." };
  return { ok: true, emoji: grapheme };
}
