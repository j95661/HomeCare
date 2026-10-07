import { getToken } from "firebase/messaging";
import { call } from "./api";
import { messagingOrNull } from "./firebase";
import { isStandaloneDisplay, pushSubscribeBlock } from "./pwa";

export async function enablePush(): Promise<void> {
  const block = pushSubscribeBlock({
    standalone: isStandaloneDisplay(),
    pushSupported: "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
    vapidConfigured: Boolean(import.meta.env.VITE_FIREBASE_VAPID_KEY),
  });
  if (block) throw new Error(block);
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications were blocked.");
  const messaging = messagingOrNull();
  if (!messaging) throw new Error("This phone does not support web push.");
  const token = await getToken(messaging, {
    vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: registration,
  });
  if (!token) throw new Error("No push token was issued.");
  await call("registerDevice", { token, platform: navigator.platform || "web" });
}
