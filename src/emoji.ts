import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { isPermissionDenied } from "./api";
import { db } from "./firebase";
import { useSession } from "./session";

export const EMOJI_CHOICES = ["🌸", "💗", "🌷", "💐", "🎀", "🌺", "🌹", "💖", "🦋", "🌙", "✨", "🌻", "☕", "🎵", "💛", "📚"] as const;

export function withEmoji(name: string, emoji?: string): string {
  const mark = (emoji ?? "").trim();
  return mark ? `${mark} ${name}` : name;
}

export function useEmojiMap(): Map<string, string> {
  const session = useSession();
  const [emoji, setEmoji] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    return onSnapshot(
      collection(db, "users"),
      (snap) => {
        const next = new Map<string, string>();
        snap.docs.forEach((item) => next.set(item.id, String(item.get("emoji") || "")));
        setEmoji(next);
      },
      (err) => {
        if (isPermissionDenied(err)) session.onDenied();
      },
    );
  }, [session]);

  return emoji;
}
