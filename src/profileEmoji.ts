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

export function nameInitial(name: string): string {
  const letter = name.trim().match(/\p{L}/u);
  return letter ? letter[0].toLocaleUpperCase() : "?";
}

/** The mark shown beside a name: their chosen emoji, or a plain initial. */
export function nameMark(name: string, emoji?: string): string {
  const mark = (emoji ?? "").trim();
  return isProfileEmoji(mark) ? mark : nameInitial(name);
}

export function withEmoji(name: string, emoji?: string): string {
  return `${nameMark(name, emoji)} ${name}`.trim();
}
