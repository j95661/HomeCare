/** Care-friendly marks a person can put next to their name. No free-text paste. */
export const PROFILE_EMOJI = [
  "😀",
  "😊",
  "😄",
  "😁",
  "😉",
  "😍",
  "🥰",
  "😇",
  "🤗",
  "😴",
  "😎",
  "🤓",
  "👋",
  "👍",
  "👏",
  "🙏",
  "🤝",
  "💪",
  "✋",
  "🫶",
  "🦋",
  "🐝",
  "🐥",
  "🐧",
  "🦊",
  "🐻",
  "🐰",
  "🐱",
  "🐶",
  "🦉",
  "💗",
  "💖",
  "💛",
  "💜",
  "💙",
  "💚",
  "⭐",
  "🌟",
  "✨",
  "💫",
] as const;

const ALLOWED = new Set<string>(PROFILE_EMOJI);

export function isProfileEmoji(value: string): boolean {
  return ALLOWED.has(value);
}

/** One emoji grapheme from the phone keyboard. Keep identical to functions/src/logic/emoji.ts. */
export function isSingleEmoji(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 32) return false;
  const parts = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed)];
  if (parts.length !== 1) return false;
  if (/\p{Extended_Pictographic}/u.test(trimmed)) return true;
  if (/^\p{Regional_Indicator}{2}$/u.test(trimmed)) return true;
  return /\u20E3/u.test(trimmed);
}

export function nameInitial(name: string): string {
  const letter = name.trim().match(/\p{L}/u);
  return letter ? letter[0].toLocaleUpperCase() : "?";
}

/** The emoji beside a name. A letter initial is only for the monthly calendar. */
export function nameMark(_name: string, emoji?: string): string {
  const mark = (emoji ?? "").trim();
  return isSingleEmoji(mark) ? mark : "";
}

export function withEmoji(name: string, emoji?: string): string {
  return `${nameMark(name, emoji)} ${name}`.trim();
}
