import { useEffect, useRef, useState, type ClipboardEvent, type ReactNode, type RefObject } from "react";
import { getBlob, ref, uploadBytes } from "firebase/storage";
import { storage } from "./firebase";
import { imageContentType, imageFileFromClipboard, imageObjectName, imageProblem } from "./media";

export async function uploadCareImage(path: string, file: File): Promise<void> {
  const type = imageContentType(file);
  await uploadBytes(ref(storage, path), file, { contentType: type });
}

export function careImagePath(folder: string, file: File): string {
  return `${folder}/${imageObjectName(file)}`;
}

export function CareImage({
  path,
  className = "care-image",
  testId = "care-image",
}: {
  path: string;
  className?: string;
  testId?: string;
}) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let current = "";
    setUrl("");
    setFailed(false);
    getBlob(ref(storage, path))
      .then((blob) => {
        if (!active) return;
        current = URL.createObjectURL(blob);
        setUrl(current);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (current) URL.revokeObjectURL(current);
    };
  }, [path]);

  if (failed) return <p className="meta">Picture unavailable</p>;
  if (!url) return null;
  return <img className={className} src={url} alt="" data-testid={testId} />;
}

export function usePictureDraft() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function choose(next: File | null) {
    if (!next) {
      setFile(null);
      setError("");
      return;
    }
    const problem = imageProblem(next);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setFile(next);
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const image = imageFileFromClipboard(event.clipboardData);
    if (!image) return;
    event.preventDefault();
    choose(image);
  }

  function clear() {
    setFile(null);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  }

  return { file, preview, error, inputRef, choose, onPaste, clear };
}

export function PictureControls({
  testId,
  inputRef,
  preview,
  onChoose,
  onClear,
}: {
  testId: string;
  inputRef: RefObject<HTMLInputElement | null>;
  preview: string;
  onChoose: (file: File | null) => void;
  onClear: () => void;
}): ReactNode {
  return (
    <>
      <input
        ref={inputRef}
        className="picture-file"
        type="file"
        accept="image/*"
        data-testid={`${testId}-file`}
        aria-label="Add a picture, GIF, or meme"
        onChange={(event) => {
          onChoose(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />
      {preview ? (
        <div className="picture-preview" data-testid={`${testId}-preview`}>
          <img src={preview} alt="Picture to send" />
          <button type="button" data-testid={`${testId}-remove`} onClick={onClear}>
            Remove picture
          </button>
        </div>
      ) : null}
    </>
  );
}

export function PictureButton({
  testId,
  onOpen,
}: {
  testId: string;
  onOpen: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      className="picture-toggle"
      data-testid={`${testId}-button`}
      aria-label="Add a picture, GIF, or meme"
      onClick={onOpen}
    >
      🖼️
    </button>
  );
}
