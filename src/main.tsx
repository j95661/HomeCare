import { createRoot } from "react-dom/client";
import { App } from "./App";
import { unlockAudio } from "./audio";
import "./styles.css";

document.addEventListener("pointerdown", () => unlockAudio(), { once: true });

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js");
}

createRoot(document.getElementById("root")!).render(<App />);
