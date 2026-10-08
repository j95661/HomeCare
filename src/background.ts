import { useEffect } from "react";
import { getBlob, ref } from "firebase/storage";
import { storage } from "./firebase";

/** Paint a personal picture behind the app. A blank path restores the plain theme. */
export function useAccountBackground(path: string): void {
  useEffect(() => {
    const root = document.documentElement;
    if (!path) {
      root.style.removeProperty("--app-background");
      delete root.dataset.background;
      return;
    }
    let active = true;
    let current = "";
    getBlob(ref(storage, path))
      .then((blob) => {
        if (!active) return;
        current = URL.createObjectURL(blob);
        root.style.setProperty("--app-background", `url("${current}")`);
        root.dataset.background = "on";
      })
      .catch(() => {
        if (!active) return;
        root.style.removeProperty("--app-background");
        delete root.dataset.background;
      });
    return () => {
      active = false;
      root.style.removeProperty("--app-background");
      delete root.dataset.background;
      if (current) URL.revokeObjectURL(current);
    };
  }, [path]);
}
