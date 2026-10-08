/** Pictures, GIFs, and memes attached to a handover note or a message. */

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

const FROM_NAME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

export function imageContentType(file: File): string {
  const raw = file.type.toLowerCase();
  if (raw === "image/jpg" || raw === "image/pjpeg") return "image/jpeg";
  if (EXTENSIONS[raw]) return raw;
  const ext = file.name.toLowerCase().split(".").pop() || "";
  return FROM_NAME[ext] || "";
}

export function imageProblem(file: File): string {
  if (file.size > MAX_IMAGE_BYTES) return "That picture is larger than 8 MB.";
  if (file.size <= 0 || !imageContentType(file)) return "Choose a picture, GIF, or meme.";
  return "";
}

/** Storage object name. Matches the Firestore path rule `[A-Za-z0-9._-]`. */
export function imageObjectName(file: File): string {
  const ext = EXTENSIONS[imageContentType(file)] || "img";
  const stamp = Date.now().toString(36);
  const salt = Math.random().toString(36).slice(2, 10);
  return `p${stamp}${salt}.${ext}`;
}

export function imageFileFromClipboard(data: DataTransfer | null): File | null {
  if (!data) return null;
  const files = Array.from(data.files || []);
  const named = files.find((file) => imageContentType(file));
  if (named) return named;
  for (const item of Array.from(data.items || [])) {
    if (item.kind !== "file" || !item.type.toLowerCase().startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}

/** Thread list and push text. A picture with no caption reads as “Picture”. */
export function messagePreview(text: string, hasImage: boolean): string {
  const trimmed = text.trim();
  const value = trimmed || (hasImage ? "Picture" : "");
  return value.slice(0, 140);
}
