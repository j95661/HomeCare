/** Insert plain text, including an emoji, into a message draft. */
export function insertText(
  value: string,
  start: number,
  end: number,
  insert: string,
  max = 2000,
): { value: string; cursor: number } {
  const safeStart = Math.max(0, Math.min(start, value.length));
  const safeEnd = Math.max(safeStart, Math.min(end, value.length));
  const next = value.slice(0, safeStart) + insert + value.slice(safeEnd);
  if (next.length > max) return { value, cursor: safeStart };
  return { value: next, cursor: safeStart + insert.length };
}
