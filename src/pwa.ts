export function pushSubscribeBlock(input: {
  standalone: boolean;
  pushSupported: boolean;
  vapidConfigured: boolean;
}): string | null {
  if (!input.standalone) {
    return "Add HammondCare to your Home Screen and open it from that icon. On iPhone, push works on iOS 16.4 or later only after you open the app from the Home Screen, not from a browser tab.";
  }
  if (!input.pushSupported) return "This phone does not support web push.";
  if (!input.vapidConfigured) return "Push is not configured yet. Add the web app VAPID key, then rebuild.";
  return null;
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const media = window.matchMedia?.("(display-mode: standalone)")?.matches ?? false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return Boolean(media || nav.standalone);
}
