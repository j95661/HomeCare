/** Keep this identical to messagePreview in src/media.ts. */
export function messagePreview(text: string, hasImage: boolean): string {
  const trimmed = text.trim();
  const value = trimmed || (hasImage ? "Picture" : "");
  return value.slice(0, 140);
}

export function replaceParticipant(ids: string[], fromUid: string, toUid: string): string[] {
  return ids.map((id) => (id === fromUid ? toUid : id));
}
