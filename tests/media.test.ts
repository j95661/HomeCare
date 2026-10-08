import { describe, expect, it } from "vitest";
import { messagePreview as serverPreview } from "../functions/src/logic/messages";
import { imageContentType, imageFileFromClipboard, imageObjectName, imageProblem, messagePreview } from "../src/media";

function file(name: string, type: string, bytes = 8): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("care pictures", () => {
  it("accepts photos, GIFs, and memes the phone keyboard can hand over", () => {
    expect(imageContentType(file("snap.jpg", "image/jpeg"))).toBe("image/jpeg");
    expect(imageContentType(file("snap.heic", ""))).toBe("image/heic");
    expect(imageContentType(file("meme.gif", "image/gif"))).toBe("image/gif");
    expect(imageProblem(file("notes.txt", "text/plain"))).toBe("Choose a picture, GIF, or meme.");
    expect(imageProblem(file("huge.png", "image/png", 8 * 1024 * 1024 + 1))).toBe("That picture is larger than 8 MB.");
    expect(imageProblem(file("ok.png", "image/png"))).toBe("");
    expect(imageObjectName(file("ok.png", "image/png"))).toMatch(/^p[a-z0-9]+\.png$/);
  });

  it("takes a pasted image and leaves plain text alone", () => {
    const gif = file("keyboard.gif", "image/gif");
    const pasted = imageFileFromClipboard({ files: [gif], items: [] } as unknown as DataTransfer);
    expect(pasted).toBe(gif);
    expect(imageFileFromClipboard({ files: [], items: [] } as unknown as DataTransfer)).toBeNull();
  });

  it("uses Picture when a message is only an image", () => {
    expect(messagePreview("", true)).toBe("Picture");
    expect(messagePreview("  hello 🌸  ", false)).toBe("hello 🌸");
    expect(messagePreview("x".repeat(200), true)).toHaveLength(140);
    expect(messagePreview("", false)).toBe("");
    expect(serverPreview("", true)).toBe(messagePreview("", true));
    expect(serverPreview("hello", false)).toBe(messagePreview("hello", false));
  });
});
